require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');
const archiver = require('archiver');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const folderParent = process.env.FOLDER_PARENT;

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const drive = google.drive({
  version: 'v3',
  auth: oAuth2Client,
});

var uploadModule = (module.exports = {
  getParentFolderId: async () => {
    const folderResponse = await drive.files.list({
      q: `name = '${folderParent}' and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
    });
    const folderId =
      folderResponse.data.files.length > 0
        ? folderResponse.data.files[0].id
        : null;

    if (!folderId) {
      console.log('Folder not found');
    } else {
      console.log('Folder ID:', folderId);
    }
    return folderId;
  },
  setFilePublic: async (fileId) => {
    try {
      await drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
    } catch (error) {
      console.error(error);
    }
  },
  uploadFile: async (file, name) => {
    try {
      const fileStream = fs.createReadStream(file.path);
      const folderId = await uploadModule.getParentFolderId();
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
      uploadModule.setFilePublic(fileId);
      console.log('success', createFile.data);
    } catch (error) {
      console.error(error);
    }
  },
  downloadAllFile: async (req, res) => {
    try {
      const folderId = await uploadModule.getParentFolderId();
      const response = await drive.files.list({
        q: `'${folderId}' in parents`, // Lọc theo thư mục
        fields: 'files(id, name)', // Lấy ID và tên tệp
      });

      const files = response.data.files;

      if (files.length === 0) {
        return res.status(404).json({ message: 'Thư mục không có tệp' });
      }

      // Tạo tệp ZIP để lưu tất cả tệp
      const zipFilePath = './hacfiles.zip';
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Mức độ nén
      });

      archive.pipe(output);

      // Tải từng tệp và thêm vào tệp ZIP
      const fileDownloadPromises = files.map(async (file) => {
        try {
          const fileData = await drive.files.get({
            fileId: file.id,
            alt: 'media', // Đảm bảo tải dữ liệu tệp
          });

          // Thêm tệp vào archive (ZIP)
          archive.append(fileData.data, { name: file.name });
        } catch (err) {
          console.error(`Lỗi tải tệp ${file.name}:`, err);
        }
      });

      // Đợi tất cả các tệp được tải về
      await Promise.all(fileDownloadPromises);

      archive.finalize();

      output.on('close', function () {
        // Sau khi hoàn tất việc nén, trả tệp ZIP cho người dùng
        res.download(zipFilePath, 'hacfiles.zip', (err) => {
          if (err) {
            console.error('Lỗi khi tải xuống:', err);
          }
        });
      });
    } catch (error) {
      console.error('Lỗi khi tải xuống tệp:', error);
      res.status(500).json({ message: 'Lỗi khi tải xuống tệp' });
    }
  },
});
