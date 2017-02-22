echo 'Collecting performance metrics for Home Page - Started'
node WPT_Metrics/WAG_WPT_Jenkin.js --env 'https://www.walgreens.com' --pageName 'home' > reports/home.tap
echo 'Collecting performance metrics for Home Page - Completed'

echo 'Collecting performance metrics for Offers Page - Started'
node WPT_Metrics/WAG_WPT_Jenkin.js --env 'https://www.walgreens.com' --pageName 'offers' > reports/offers.tap
echo 'Collecting performance metrics for Offers Page - Completed'