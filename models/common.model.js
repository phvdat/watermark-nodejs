const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

async function sendFileToTelegram(bot, filePath, fileName) {
  const workbook = xlsx.readFile(filePath);
  const csvFilePath = path.join(__dirname, `${fileName}.csv`);
  const csvData = xlsx.utils.sheet_to_csv(
    workbook.Sheets[workbook.SheetNames[0]]
  );

  // Write CSV data to a new file
  fs.writeFileSync(csvFilePath, csvData);
  bot
    .sendDocument('5357261496', csvFilePath)
    .then(() => {
      fs.unlink(csvFilePath, (err) => {
        if (err) {
          console.error('Error deleting file:', err);
        } else {
          console.log('CSV file deleted successfully.');
        }
      });
    })
    .catch((error) => {
      console.error('Error sending file:', error);
      fs.unlink(csvFilePath, (err) => {
        if (err) {
          console.error('Error deleting file after failure:', err);
        } else {
          console.log('CSV file deleted successfully after failure.');
        }
      });
    });
}

module.exports = { sendFileToTelegram };
