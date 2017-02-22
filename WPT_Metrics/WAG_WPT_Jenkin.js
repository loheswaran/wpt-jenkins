var WebPageTest = require('webpagetest');
var json2csv = require('json2csv');
var read = require('read-file');
var fs = require('fs');
var argv = require('optimist').argv;
var jsonfile = require('jsonfile');

//Commandline arguments
var arg_pageName = argv.pageName;
var arg_mobile = argv.mobile;
var arg_localServer = argv.localServer;
var arg_env = argv.env;

//Constants
var configFile = "config.json";
var wpt, webpagetestResultUrl;
var breakpointIndex = 0;
var pageConfig;

//csv fields
var assetRequestsMetricsFields = ['js_count', 'image_count', 'css_count'];
var assetRequestsSizeMetricsFields = ['js_size', 'image_size', 'css_size'];
var perfMetricsFields = ['loadTime', 'firstPaint', 'domContentLoadedEventStart', 'lastVisualChange'];

//Read config
var configString = read.sync(configFile, 'utf8');
var config = JSON.parse(configString);

initializeWPT();

function initializeWPT() {
    if (arg_localServer) {
        wpt = new WebPageTest(arg_localServer);
        webpagetestResultUrl = 'http://' + arg_localServer + '/result/';
    } else {
        wpt = new WebPageTest('www.webpagetest.org', 'A.6f0d4142bbe78c7bc5017d6dab1b4f49');
        webpagetestResultUrl = 'https://www.webpagetest.org/result/';
    }
    getPage();
}

/*function testAllPages() {
    if (config) {
        for (i in config.pages) {
            var pageConfig = config.pages[i];
            for (j in pageConfig.breakpoints) {
                var breakpoint = pageConfig.breakpoints[j];
                testOptions.mobile = false;
                if (breakpoint.name === "mobile") {
                    testOptions.mobile = true;
                }
                var url = arg_env + pageConfig.url;
                runTest(url, pageConfig, breakpoint);
            }
        }
    }
}*/

function getPage() {
    if (!config) {
        console.log("******** config.json configuration NOT FOUND ********");
        return;
    }
    for (i in config.pages) {
        if (config.pages[i].name === arg_pageName) {
            pageConfig = config.pages[i];
            getBreakpoints();
            return;
        }
    }
}

function getBreakpoints() {
    if (pageConfig && pageConfig.breakpoints && breakpointIndex < pageConfig.breakpoints.length) {
        var breakpoint = pageConfig.breakpoints[breakpointIndex];
        var url = arg_env + pageConfig.url;
        runTest(url, pageConfig, breakpoint)
    }
}

function runTest(url, pageConfig, breakpoint) {
    var testOptions = {};
    testOptions.pollResults = 5;
    testOptions.runs = 1;
    testOptions.video = false;
    testOptions.firstViewOnly = true;
    if (breakpoint.name === "mobile") {
        testOptions.mobile = true;
    } else {
        testOptions.mobile = false;
    }
    wpt.runTest(url, testOptions, function(err, data) {
        if (null != data && '' != data) {
            console.log('Test ID : ' + data.data.id);
            webpagetestResultUrl += data.data.id;
            console.log('Test URL : ' + webpagetestResultUrl);
            if (data.statusCode == 200) {
                generatePerfMetrics(data.data.median.firstView, pageConfig, breakpoint);
            }
        }
        if (null != err && '' != err) {
            console.log(err);
        }
        breakpointIndex++;
        getBreakpoints();
    });
}

function generatePerfMetrics(results, pageConfig, breakpoint) {
    getSLAReport(results, pageConfig.name, breakpoint);
    if (breakpoint.name === "desktop") {
        serviceCallPerfMetrics(results, pageConfig.name, pageConfig.services);
    }
}

function getSLAReport(results, pageName, breakpoint) {
    var loadTime = results.loadTime;
    var servPerfResult = [];
    var perfMetrics = json2csv({ data: results, fields: perfMetricsFields });
    var assetDetails = {};
    var img_count = 0,
        css_count = 0,
        js_count = 0,
        img_size = 0,
        css_size = 0,
        js_size = 0;
    var javascriptList = ['application/javascript', 'application/x-javascript', 'text/javascript'];
    for (var i = 0; i < results.requests.length - 1; i++) {
        var currentContentType = results.requests[i].contentType;
        var isBeforeOnload = (results.requests[i].download_start < loadTime) ? true : false;
        if (isBeforeOnload && null != currentContentType) {
            if (javascriptList.indexOf(currentContentType) != -1 && !results.requests[i].url.includes('id.json?')) {
                js_count++;
                js_size += results.requests[i].bytesIn;
            } else if (currentContentType.startsWith('image')) {
                img_count++;
                img_size += results.requests[i].bytesIn;
            } else if (currentContentType == "text/css") {
                css_count++;
                css_size += results.requests[i].bytesIn;
            }
        }
    }

    assetDetails["js_count"] = js_count;
    assetDetails["image_count"] = img_count;
    assetDetails["css_count"] = css_count;

    assetDetails["js_size"] = js_size / 1024;
    assetDetails["image_size"] = img_size / 1024;
    assetDetails["css_size"] = css_size / 1024;

    var assetRequestsMetrics = json2csv({ data: assetDetails, fields: assetRequestsMetricsFields });
    var assetRequestsSizeMetrics = json2csv({ data: assetDetails, fields: assetRequestsSizeMetricsFields });
    
    var metricsCSVFileName = "reports/" + pageName + "_" + breakpoint.name + '_perf_metrics.csv';
    fs.writeFile(metricsCSVFileName, perfMetrics, function(err) {
        if (err) throw err;
        console.log('File Generated : ' + metricsCSVFileName);
    });
    
    var assetsReqCSVFileName = "reports/" + pageName + "_" + breakpoint.name + '_onload_assets_requests.csv';
    fs.writeFile(assetsReqCSVFileName, assetRequestsMetrics, function(err) {
        if (err) throw err;
        console.log('File Generated : ' + assetsReqCSVFileName);
    });
    
    var assetsSizeCSVFileName = "reports/" + pageName + "_" + breakpoint.name + '_onload_assets_size.csv';
    fs.writeFile(assetsSizeCSVFileName, assetRequestsSizeMetrics, function(err) {
        if (err) throw err;
        console.log('File Generated : ' + assetsSizeCSVFileName);
    });
    prepareTapReport(breakpoint.sla, assetDetails);
}

function serviceCallPerfMetrics(results, pageName, services) {
    var isSvcPresent = false;
    var headerData = {};
    var serviceCallMetricsFields = [];
    for (var j = 0; j < services.length; j++) {
        var svcURL = services[j].url;
        var svcName = services[j].name;
        for (var i = 0; i < results.requests.length - 1; i++) {
            if (results.requests[i].url.startsWith(svcURL)) {
                isSvcPresent = true;
                var servPerfResult = [];
                servPerfResult.push(results.requests[i].load_ms);
                headerData['' + svcName] = results.requests[i].load_ms;
                serviceCallMetricsFields.push(svcName);
                break;
            }
        }
    }
    if (isSvcPresent) {
        var headerPerfMetrics = json2csv({ data: headerData, fields: serviceCallMetricsFields });
        var svcFilePrefix = "reports/" + pageName + '_svc_perf_metrics.csv';
        fs.writeFile(svcFilePrefix, headerPerfMetrics, function(err) {
            if (err) throw err;
            console.log('File Generated : ' + svcFilePrefix);
        });
    }
}

function prepareTapReport(sla, data) {
    var pass = 0, fail = 0;
    var keys = assetRequestsMetricsFields.concat(assetRequestsSizeMetricsFields);
    var count = 0;
    keys.forEach(function(element) {
        count++;
        if (Number(data[element]) <= Number(sla[element])) {
            pass++;
            console.log('ok ' + count + ' ' + element + ' : Actual : ' + data[element] + ', SLA : ' + sla[element]);
        } else {
            fail++;
            console.log('not ok ' + count + ' ' + element + ' : Actual : ' + data[element] + ' but SLA : ' + sla[element]);
        }
    });
    console.log('# tests ' + keys.length);
    console.log("# pass " + pass);
    console.log('# fail ' + fail);
}