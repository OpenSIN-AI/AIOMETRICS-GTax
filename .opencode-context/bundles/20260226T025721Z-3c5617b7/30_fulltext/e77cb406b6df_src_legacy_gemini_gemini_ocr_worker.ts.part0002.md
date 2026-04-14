# Context Fulltext

- source_path: src/legacy/gemini/gemini_ocr_worker.ts
- source_sha256: 0d22c1a5d11269c43c1cfba925c995fc9bb88e29160494798cf8ba261b9ddd41
- chunk: 2/2

```text
meType || item.mimeType || '';
        observedMime = mime;
        const size = Number.parseInt(meta.data.size || '0', 10);
        if (size > ABSOLUTE_MAX_FILE_MB * 1024 * 1024) {
          failureReason = `file_too_large_${size}`;
        } else {
          let imageForOcr = '';
          if (mime.startsWith('image/')) {
            const ext = mime.includes('png') ? '.png' : (mime.includes('webp') ? '.webp' : '.jpg');
            const localFile = path.join(tempDir, `${item.fileId}${ext}`);
            await downloadToFile(item.fileId, localFile);
            imageForOcr = localFile;
            if (size > MAX_FILE_MB * 1024 * 1024) {
              extractionNote = 'oversize_image_processed';
            }
          } else if (mime === 'application/pdf') {
            const localPdf = path.join(tempDir, `${item.fileId}.pdf`);
            await downloadToFile(item.fileId, localPdf);
            imageForOcr = await renderFirstPdfPageToPng(localPdf, path.join(tempDir, `${item.fileId}_p1`));
            if (size > MAX_FILE_MB * 1024 * 1024) {
              extractionNote = 'oversize_pdf_processed';
            }
          } else if (mime.startsWith('application/vnd.google-apps.')) {
            const exportedPdf = path.join(tempDir, `${item.fileId}_export.pdf`);
            const exported = await exportGoogleFileToPdf(item.fileId, exportedPdf);
            if (exported) {
              imageForOcr = await renderFirstPdfPageToPng(exportedPdf, path.join(tempDir, `${item.fileId}_gp1`));
              extractionNote = 'google_apps_export_pdf';
            } else {
              failureReason = `google_apps_export_failed_${mime}`;
            }
          } else {
            const localRaw = path.join(tempDir, `${item.fileId}.raw`);
            await downloadToFile(item.fileId, localRaw);
            if (
              mime.startsWith('text/') ||
              mime.includes('json') ||
              mime.includes('xml') ||
              mime.includes('csv')
            ) {
              text = fs.readFileSync(localRaw, 'utf8').trim();
              if (text.length >= 6) {
                extractionNote = 'direct_text_file';
              } else {
                failureReason = `text_file_empty_${mime}`;
              }
            } else {
              failureReason = `unsupported_mime_${mime || 'unknown'}`;
            }
          }

          if (text.length < 6 && imageForOcr) {
            try {
              text = (await analyzeWithQwen(imageForOcr)).trim();
              if (text.length >= 6) extractionNote = extractionNote || 'qwen_swarm_worker';
            } catch {
              // continue with next fallback
            }
          }
          if (text.length < 6 && imageForOcr) {
            try {
              text = (await analyzeWithGeminiVision(imageForOcr)).trim();
              if (text.length >= 6) extractionNote = 'gemini_vision_fallback';
            } catch {
              // continue with next fallback
            }
          }
          if (text.length < 6 && imageForOcr) {
            try {
              text = (await analyzeWithTesseract(imageForOcr)).trim();
              if (text.length >= 6) extractionNote = 'tesseract_swarm_fallback';
            } catch {
              // keep empty text
            }
          }
          if (text.length < 6 && !failureReason) {
            failureReason = 'all_ocr_models_failed';
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failureReason = `worker_exception_${message.slice(0, 140)}`;
        console.warn(`[Worker ${workerId}] failed ${item.fileId}: ${message}`);
      }

      if (text.length >= 6) {
        const metadataObj = {
          ...previousMetadata,
          extraction_status: 'ok',
          extraction_note: extractionNote || 'ocr_success',
          extracted_at: nowIso,
          ocr_attempts: attempts,
          mime_type_observed: observedMime
        };
        updates.push({
          range: `belege!${ocrCol}${item.rowIndex}`,
          values: [[text]]
        });
        updates.push({
          range: `belege!${metadataColLetter}${item.rowIndex}`,
          values: [[JSON.stringify(metadataObj)]]
        });
        success++;
      } else {
        const finalNoText = attempts >= FINAL_NO_TEXT_AFTER_ATTEMPTS;
        const metadataObj = {
          ...previousMetadata,
          extraction_status: finalNoText ? 'final_no_text' : 'retry_pending',
          extraction_note: finalNoText ? 'final_no_text_after_fallback_chain' : 'retry_after_fallback_chain',
          last_failure_reason: failureReason || 'unknown',
          extracted_at: nowIso,
          ocr_attempts: attempts,
          mime_type_observed: observedMime
        };
        updates.push({
          range: `belege!${metadataColLetter}${item.rowIndex}`,
          values: [[JSON.stringify(metadataObj)]]
        });
        failed++;
        if (finalNoText) noTextFinalized++;
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
    }
  } finally {
    if (tesseractWorker) {
      await tesseractWorker.terminate();
      tesseractWorker = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`[Worker ${workerId}] success=${success} failed=${failed} finalized_no_text=${noTextFinalized}`);
}

runWorker().catch((error) => {
  console.error('gemini_ocr_worker failed:', error);
  process.exit(1);
});

```
