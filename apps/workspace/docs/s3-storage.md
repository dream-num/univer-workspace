# S3 file storage

English | [简体中文](s3-storage.zh-CN.md)

Set `BLOB_STORE=s3` and `BLOB_S3_BUCKET` to use an existing private bucket. Configure its
region through `BLOB_S3_REGION` or your AWS environment. For S3-compatible services, set
`BLOB_S3_ENDPOINT` and enable `BLOB_S3_FORCE_PATH_STYLE` if your provider requires it.
Use `BLOB_S3_PREFIX` to store files under a prefix. See the [example configuration](../.env.example).

Give the server an IAM role or AWS credentials with `s3:ListBucket` on the bucket and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:AbortMultipartUpload` on its
Workspace objects. Use bucket lifecycle rules to expire incomplete multipart uploads and,
for versioned buckets, to control how long deleted versions are retained.
Docker deployments still need a persistent volume for both SQLite databases.

## Move existing files from local storage

1. Stop all Workspace servers. Back up both SQLite databases and the directory configured by
   `BLOB_DIRECTORY`.
2. Copy the UUID-named files to an empty destination, preserving their names. This example uses
   the default local directory, the bucket `workspace-objects` and the prefix `workspace`.

   ```bash
   aws s3 sync .data/univer-workspace-blobs/ s3://workspace-objects/workspace/ \
     --exclude '*' --include '????????-????-????-????-????????????' --no-follow-symlinks
   ```

3. Verify the destination file count, names and sizes. Set the matching bucket and prefix,
   restart Workspace, and open an existing file and an embedded attachment.

Keep the original files and database backups together. To roll back after writes resume,
stop Workspace and copy new objects back to local storage or restore the matching backups.
