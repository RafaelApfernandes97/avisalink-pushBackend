const Minio = require('minio');
const logger = require('../utils/logger');

// Configure MinIO client
const minioConfig = {
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
};

logger.info('MinIO configuration:', {
  endPoint: minioConfig.endPoint,
  port: minioConfig.port,
  useSSL: minioConfig.useSSL,
  accessKey: minioConfig.accessKey ? `${minioConfig.accessKey.substring(0, 4)}****` : 'not set'
});

const minioClient = new Minio.Client(minioConfig);

const bucketName = process.env.MINIO_BUCKET_NAME || 'notification-images';

// Initialize MinIO bucket
const initializeBucket = async () => {
  try {
    // Test MinIO connection first
    try {
      const exists = await minioClient.bucketExists(bucketName);

      if (!exists) {
        await minioClient.makeBucket(bucketName, 'us-east-1');
        logger.info(`MinIO bucket '${bucketName}' created successfully`);

        // Set bucket policy to allow public read access for images
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucketName}/*`]
            }
          ]
        };

        await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
        logger.info('MinIO bucket policy set successfully');
      } else {
        logger.info(`MinIO bucket '${bucketName}' already exists`);
      }
    } catch (minioError) {
      logger.error('MinIO connection failed. The application will continue, but image uploads will not work.', {
        error: minioError.message,
        code: minioError.code,
        endpoint: process.env.MINIO_ENDPOINT,
        port: process.env.MINIO_PORT,
        useSSL: process.env.MINIO_USE_SSL
      });
      logger.warn('Please verify your MinIO configuration:');
      logger.warn('1. Check if MINIO_ENDPOINT is correct (should be the API endpoint, not console)');
      logger.warn('2. Verify MINIO_ACCESS_KEY and MINIO_SECRET_KEY are correct');
      logger.warn('3. Check if the bucket exists in your MinIO console');
      logger.warn('4. Verify network connectivity and firewall rules');

      // Don't throw error, let the app continue without MinIO
    }
  } catch (error) {
    logger.error('Unexpected error during MinIO initialization:', error);
    // Don't throw error, let the app continue
  }
};

// Upload file to MinIO
const uploadFile = async (fileName, filePath, contentType = 'image/png') => {
  try {
    const metaData = {
      'Content-Type': contentType
    };

    await minioClient.fPutObject(bucketName, fileName, filePath, metaData);

    // Generate public URL (omit port 443 for HTTPS and 80 for HTTP)
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const port = process.env.MINIO_PORT;
    const portSuffix = (protocol === 'https' && port === '443') || (protocol === 'http' && port === '80')
      ? ''
      : `:${port}`;
    const url = `${protocol}://${process.env.MINIO_ENDPOINT}${portSuffix}/${bucketName}/${fileName}`;

    logger.info(`File uploaded successfully: ${fileName}`);
    return url;
  } catch (error) {
    logger.error('Error uploading file to MinIO:', error);
    throw error;
  }
};

// Upload buffer to MinIO
const uploadBuffer = async (fileName, buffer, contentType = 'image/png') => {
  try {
    const metaData = {
      'Content-Type': contentType
    };

    await minioClient.putObject(bucketName, fileName, buffer, buffer.length, metaData);

    // Generate public URL (omit port 443 for HTTPS and 80 for HTTP)
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const port = process.env.MINIO_PORT;
    const portSuffix = (protocol === 'https' && port === '443') || (protocol === 'http' && port === '80')
      ? ''
      : `:${port}`;
    const url = `${protocol}://${process.env.MINIO_ENDPOINT}${portSuffix}/${bucketName}/${fileName}`;

    logger.info(`Buffer uploaded successfully: ${fileName}`);
    return url;
  } catch (error) {
    logger.error('Error uploading buffer to MinIO:', error);
    throw error;
  }
};

// Delete file from MinIO
const deleteFile = async (fileName) => {
  try {
    await minioClient.removeObject(bucketName, fileName);
    logger.info(`File deleted successfully: ${fileName}`);
  } catch (error) {
    logger.error('Error deleting file from MinIO:', error);
    throw error;
  }
};

// Get presigned URL for upload
const getPresignedUploadUrl = async (fileName, expirySeconds = 3600) => {
  try {
    const url = await minioClient.presignedPutObject(bucketName, fileName, expirySeconds);
    return url;
  } catch (error) {
    logger.error('Error generating presigned URL:', error);
    throw error;
  }
};

module.exports = {
  minioClient,
  bucketName,
  initializeBucket,
  uploadFile,
  uploadBuffer,
  deleteFile,
  getPresignedUploadUrl
};
