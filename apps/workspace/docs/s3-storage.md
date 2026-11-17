# S3 file storage

English | [简体中文](s3-storage.zh-CN.md)

## Choose a storage backend

**Local directory** is the default. Override `BLOB_DIRECTORY` to use another writable directory.

```dotenv
BLOB_STORE=local
BLOB_DIRECTORY=.data/univer-workspace-blobs
```

**AWS S3** requires an existing private bucket. Set the bucket name and its region.
You can omit `BLOB_S3_REGION` if the region is already set through `AWS_REGION` or an AWS profile.
`BLOB_S3_PREFIX` is optional and defaults to the root of the bucket.

```dotenv
BLOB_STORE=s3
BLOB_S3_BUCKET=workspace-objects
BLOB_S3_REGION=us-east-1
```

**MinIO** uses the same S3 settings. Add the S3 API endpoint reachable from the Workspace server.
This example uses path-style addressing.

```dotenv
BLOB_S3_ENDPOINT=http://minio:9000
BLOB_S3_FORCE_PATH_STYLE=true
```

Use a workload role or provide `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to the server.
Temporary credentials also require `AWS_SESSION_TOKEN`. Grant `s3:ListBucket` on the bucket and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:AbortMultipartUpload` on its
Workspace objects. Use bucket lifecycle rules to expire incomplete multipart uploads and,
for versioned buckets, to control how long deleted versions are retained.

## Apply the settings

If the deployment already has local files, [copy them before switching to S3](#move-existing-files-from-local-storage).

- **Local development** — Copy [`.env.example`](../.env.example) to `apps/workspace/.env` on first setup.
  Edit the storage settings there and restart `pnpm workspace:dev:server`.
- **Docker** — Save the storage settings in `workspace-storage.env` and add `--env-file ./workspace-storage.env`
  to your existing `docker run` command. Recreate the container with the same volume mounted at
  `/app/univer-workspace/.data`. If you use SQLite, both databases still use that volume when files live in S3.
- **Kubernetes** — Put `BLOB_*` in the Workspace container's `env`, use a workload identity or a Secret
  for credentials, and keep the existing data PVC. For this repository's [Deploy Workspace workflow](../../../.github/workflows/push.yml),
  edit the target manifest under `deploy/colla-workspace/` in `dream-num/helm-chart-private` before rollout.

## Move existing files from local storage

1. Stop all Workspace servers. Back up both SQLite databases or take a full PostgreSQL database dump.
   Also back up the directory configured by `BLOB_DIRECTORY`.
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
