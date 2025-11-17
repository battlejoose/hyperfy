# 📦 Heroku Asset Storage Guide

## The Problem

On Heroku, the filesystem is **ephemeral** - any files written to disk are deleted when the server restarts. This means:

- ✅ **Database data persists** (if using Postgres)
- ❌ **Uploaded assets are lost** (if using local storage)

When assets are uploaded, they're stored in `world/assets/` on the filesystem. After a Heroku restart, these files are gone, but the database still references them, causing 404 errors.

## Solution: Use S3 for Persistent Storage

For production deployments on Heroku, you should use **S3-compatible storage** for assets. This ensures all uploaded assets persist across restarts.

### Quick Setup

1. **Set up S3 storage** (AWS S3, DigitalOcean Spaces, Cloudflare R2, etc.)

2. **Configure environment variables:**

```bash
# Set assets to use S3
heroku config:set ASSETS=s3

# Set your S3 base URL (where assets will be publicly accessible)
heroku config:set ASSETS_BASE_URL=https://your-bucket.s3.amazonaws.com

# Set your S3 connection URI
# Format: s3://access_key:secret_key@bucket.s3.region.amazonaws.com/prefix
heroku config:set ASSETS_S3_URI=s3://YOUR_ACCESS_KEY:YOUR_SECRET_KEY@your-bucket.s3.us-east-1.amazonaws.com/assets/
```

### S3 URI Format

The `ASSETS_S3_URI` format supports several patterns:

```
# AWS S3 (with region)
s3://access_key:secret_key@bucket.s3.region.amazonaws.com/prefix

# AWS S3 (defaults to us-east-1)
s3://access_key:secret_key@bucket/prefix

# Custom S3-compatible endpoint
s3://access_key:secret_key@endpoint.com/bucket/prefix
```

### Example: AWS S3

```bash
heroku config:set ASSETS=s3
heroku config:set ASSETS_BASE_URL=https://my-world-assets.s3.us-east-1.amazonaws.com
heroku config:set ASSETS_S3_URI=s3://AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY@my-world-assets.s3.us-east-1.amazonaws.com/assets/
```

### Example: DigitalOcean Spaces

```bash
heroku config:set ASSETS=s3
heroku config:set ASSETS_BASE_URL=https://my-space.nyc3.digitaloceanspaces.com
heroku config:set ASSETS_S3_URI=s3://SPACES_ACCESS_KEY:SPACES_SECRET_KEY@nyc3.digitaloceanspaces.com/my-space/assets/
```

### Example: Cloudflare R2

```bash
heroku config:set ASSETS=s3
heroku config:set ASSETS_BASE_URL=https://your-account-id.r2.cloudflarestorage.com
heroku config:set ASSETS_S3_URI=s3://R2_ACCESS_KEY:R2_SECRET_KEY@your-account-id.r2.cloudflarestorage.com/bucket/assets/
```

## What Gets Stored Where

### In Database (Postgres) - ✅ Persists
- Blueprint definitions
- Entity positions/rotations/scales
- User accounts
- World settings
- App state

### In Assets Storage - ⚠️ Needs S3 on Heroku
- Uploaded 3D models (`.glb`, `.gltf`)
- Images (`.png`, `.jpg`, `.webp`, etc.)
- Scripts (`.js` files)
- Audio files
- Video files
- Any other uploaded files

## Troubleshooting

### Assets Returning 404 After Restart

**Symptom**: Browser console shows 404 errors for assets like:
```
/assets/179d71586e675efc4af04185e1b2d3e6b7f4a5b707f1ef5e9b6497c5660ecab7.webp: 404
```

**Cause**: Using local storage on Heroku - assets were wiped on restart

**Solution**: 
1. Switch to S3 storage (see above)
2. Or accept that uploaded assets will be lost on restart (not recommended for production)

### S3 Connection Errors

**Error**: `Failed to access S3 bucket`

**Solutions**:
1. Verify your `ASSETS_S3_URI` is correct
2. Check your AWS/S3 credentials have proper permissions
3. Ensure the bucket exists and is accessible
4. Verify the bucket region matches your URI

### Assets Not Uploading to S3

**Symptom**: Assets upload but don't appear in S3

**Solutions**:
1. Check S3 bucket permissions (needs `PutObject` permission)
2. Verify `ASSETS_BASE_URL` matches your S3 public URL
3. Check server logs for S3 upload errors
4. Ensure CORS is configured on your S3 bucket if accessing from browser

## Migration from Local to S3

If you have existing assets in local storage:

1. **Set up S3** (see above)

2. **Deploy with S3 enabled** - The system will automatically:
   - Upload built-in assets to S3
   - Upload collection assets to S3
   - Use S3 for all new uploads

3. **Existing assets**: Assets referenced in the database but not in S3 will need to be re-uploaded by users, or you can write a migration script to upload them.

## Cost Considerations

### Local Storage (Not Recommended for Heroku)
- **Cost**: Free (but assets lost on restart)
- **Use case**: Development only

### AWS S3
- **Cost**: ~$0.023/GB storage + $0.005/1000 requests
- **Use case**: Production deployments

### DigitalOcean Spaces
- **Cost**: $5/month for 250GB + 1TB transfer
- **Use case**: Good alternative to AWS S3

### Cloudflare R2
- **Cost**: $0.015/GB storage (no egress fees)
- **Use case**: High-traffic deployments

## Best Practices

1. **Always use S3 on Heroku** - Local storage will lose assets on restart
2. **Set up CORS** on your S3 bucket for browser access
3. **Enable versioning** on your S3 bucket for backup/recovery
4. **Use CDN** in front of S3 for better performance (CloudFront, Cloudflare, etc.)
5. **Monitor storage usage** - Set up alerts for bucket size
6. **Use lifecycle policies** - Automatically delete old/unused assets

## Environment Variables Summary

```bash
# Required: Storage type
ASSETS=s3  # or 'local' (not recommended for Heroku)

# Required: Public base URL for assets
ASSETS_BASE_URL=https://your-bucket.s3.amazonaws.com

# Required if ASSETS=s3: S3 connection URI
ASSETS_S3_URI=s3://access_key:secret_key@bucket.s3.region.amazonaws.com/prefix
```

## Additional Resources

- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [DigitalOcean Spaces Guide](https://docs.digitalocean.com/products/spaces/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Heroku Ephemeral Filesystem](https://devcenter.heroku.com/articles/dynos#ephemeral-filesystem)

