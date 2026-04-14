# Context Fulltext

- source_path: src/drive/googleDriveService.ts
- source_sha256: b91998bb2700aac9bd3fa7de43ceb791a9e9922d5a4b259360772bcf929804ba
- chunk: 2/2

```text
e;
      const status = typeof statusRaw === 'string' ? Number.parseInt(statusRaw, 10) : statusRaw;
      if (status === 404) {
        return null;
      }
      console.error('Error getting file by id:', error);
      throw error;
    }
  }
}

```
