# S3 file storage

English | [简体中文](s3-storage.zh-CN.md)

For a PostgreSQL + S3 deployment, use this page for bucket permissions and the file copy command. The [Workspace configuration guide](configuration.md#migrate-from-sqlite-and-local-storage) covers both backends, downtime, database import and cutover checks.

**MinIO** uses the S3 settings in the configuration guide. Add the S3 API endpoint reachable from the Workspace server.
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

- **Local server** — Put the database and file storage settings together in `apps/workspace/.env`.
- **Docker** — Pass both sets of settings with `--env-file ./workspace.env` when creating the container. Retain the original data volume during migration.
- **Kubernetes** — Put the database and S3 settings in the Workspace container's `env`, use a workload identity or a Secret
  for credentials, and keep the existing data PVC. For this repository's [Deploy Workspace workflow](../../../.github/workflows/push.yml),
  edit the target manifest under `deploy/colla-workspace/` in `dream-num/helm-chart-private` before rollout.

## Move existing files from local storage

After stopping the source writers and taking the backup, copy from the actual `BLOB_DIRECTORY` to an empty prefix. This example uses the default local directory and the destination from the configuration guide.

```bash
aws s3 sync .data/univer-workspace-blobs/ s3://workspace-objects/workspace/ \
  --exclude '*' --include '????????-????-????-????-????????????' --no-follow-symlinks
```

Keep the original UUID filenames. Compare object names, counts and sizes, then import the product and collaboration databases. Start the target for validation once both steps are complete.
