const fs = require('fs');
const { google } = require('googleapis');
const apikeys = require('../apikeys.json');
const dotenv = require('dotenv');

dotenv.config();

const SCOPE = ['https://www.googleapis.com/auth/drive'];
const folderId = process.env.FOLDER_ID;

// Hàm authorize để xác thực Google Drive API
async function authorize() {
  const jwtClient = new google.auth.JWT(
    apikeys.client_email,
    null,
    apikeys.private_key,
    SCOPE
  );
  await jwtClient.authorize();
  return jwtClient;
}

// Hàm uploadFile truyền vào file và name
async function uploadFile(file, name) {
  try {
    const authClient = await authorize();
    const drive = google.drive({ version: 'v3', auth: authClient });

    const fileStream = fs.createReadStream(file.path);

    const createFile = await drive.files.create({
      requestBody: {
        name: name,
        mimeType: file.mimetype,
        parents: [folderId],
      },
      media: {
        mimeType: file.mimetype,
        body: fileStream,
      },
    });

    const fileId = createFile.data.id;
    return fileId;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}

module.exports = {
  uploadFile,
};
