/**
 * NVidia NIM AI Client
 * Analysiert Dateien mit NVidia AI (Qwen 3.5 397B)
 * - OCR für Bilder/PDFs
 * - Textextraktion
 * - Bildanalyse
 * - Datei-Kategorisierung
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface AnalysisResult {
  fileId: string;
  fileName: string;
  fileType: string;
  extractedText?: string;
  ocrText?: string;
  imageDescription?: string;
  category?: string;
  tags?: string[];
  confidence: number;
  metadata: Record<string, unknown>;
  rawResponse?: string;
}

export interface FileAnalysisRequest {
  filePath: string;
  fileName: string;
  mimeType: string;
}

export class NvidiaAIClient {
  private apiKey: string;
  private baseUrl = 'https://integrate.api.nvidia.com/v1';
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  /**
   * Datei analysieren basierend auf Typ
   */
  async analyzeFile(request: FileAnalysisRequest): Promise<AnalysisResult> {
    const { filePath, fileName, mimeType } = request;
    
    const fileId = uuidv4();
    const ext = path.extname(fileName).toLowerCase();
    
    let result: AnalysisResult = {
      fileId,
      fileName,
      fileType: mimeType,
      confidence: 0,
      metadata: {}
    };
    
    if (mimeType.startsWith('image/')) {
      const imageResult = await this.analyzeImage(filePath, fileName);
      result = { ...result, ...imageResult };
    } else if (mimeType === 'application/pdf') {
      const pdfResult = await this.analyzePdf(filePath, fileName);
      result = { ...result, ...pdfResult };
    } else if (
      mimeType.startsWith('text/') ||
      ext === '.txt' ||
      ext === '.csv' ||
      ext === '.json'
    ) {
      const textResult = await this.analyzeText(filePath);
      result = { ...result, ...textResult };
    } else {
      result.metadata.unsupportedType = true;
      result.category = 'unbekannt';
    }
    
    return result;
  }
  
  /**
   * Bild analysieren mit Vision
   */
  private async analyzeImage(filePath: string, fileName: string): Promise<Partial<AnalysisResult>> {
    try {
      const imageBuffer = fs.readFileSync(filePath);
      const base64Image = imageBuffer.toString('base64');
      
      const prompt = `Analysiere dieses Bild eines Belegs/Dokuments. 
Gib folgende Informationen zurück:
1. Was ist auf dem Bild zu sehen (detaillierte Beschreibung)?
2. Welche Art von Dokument ist es (Rechnung, Quittung, Vertrag, etc.)?
3. Welche wichtigen Informationen sind enthalten (Datum, Betrag, Firma, etc.)?
4. Welche Kategorie passt am besten?
5. Relevante Tags?

Antworte im JSON Format:
{
  "description": "...",
  "documentType": "...",
  "extractedInfo": {...},
  "category": "...",
  "tags": [...]
}`;

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: 'qwen/qwen3.5-397b-a17b',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                }
              ]
            }
          ],
          temperature: 0.2,
          max_tokens: 2048
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      );
      
      const content = response.data.choices[0]?.message?.content || '';
      
      try {
        const parsed = JSON.parse(content);
        return {
          imageDescription: parsed.description,
          category: parsed.category,
          tags: parsed.tags,
          metadata: {
            documentType: parsed.documentType,
            extractedInfo: parsed.extractedInfo
          },
          rawResponse: content,
          confidence: 0.85
        };
      } catch {
        return {
          imageDescription: content.substring(0, 1000),
          category: this.extractCategory(content),
          tags: this.extractTags(content),
          rawResponse: content,
          confidence: 0.7
        };
      }
    } catch (error) {
      console.error('Error analyzing image:', error);
      return {
        imageDescription: 'Fehler bei der Bildanalyse',
        category: 'fehler',
        confidence: 0
      };
    }
  }
  
  /**
   * PDF analysieren
   */
  private async analyzePdf(filePath: string, fileName: string): Promise<Partial<AnalysisResult>> {
    try {
      const pdfText = await this.extractTextFromPdf(filePath);

      const trimmedPdfText = pdfText.trim();
      if (!trimmedPdfText) {
        return {
          extractedText: '',
          category: 'Sonstiges',
          tags: [],
          metadata: {
            textLength: 0,
            fallbackReason: 'empty_pdf_text'
          },
          confidence: 0.4
        };
      }

      try {
        const response = await axios.post(
          `${this.baseUrl}/chat/completions`,
          {
            model: 'qwen/qwen3.5-397b-a17b',
            messages: [
              {
                role: 'user',
                content: `Analysiere diesen Dokumenttext und extrahiere:
1. Dokumenttyp (Rechnung, Quittung, etc.)
2. Wichtige Informationen (Datum, Betrag, Firma, etc.)
3. Kategorie
4. Tags

Text:
${pdfText.substring(0, 8000)}

Antworte JSON:
{
  "documentType": "...",
  "extractedInfo": {...},
  "category": "...",
  "tags": [...]
}`
              }
            ],
            temperature: 0.2,
            max_tokens: 2048
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 180000
          }
        );
        
        const content = response.data.choices[0]?.message?.content || '';
        
        try {
          const parsed = JSON.parse(content);
          return {
            extractedText: pdfText,
            category: parsed.category,
            tags: parsed.tags,
            metadata: {
              documentType: parsed.documentType,
              extractedInfo: parsed.extractedInfo,
              textLength: pdfText.length
            },
            rawResponse: content,
            confidence: 0.9
          };
        } catch {
          return {
            extractedText: pdfText.substring(0, 5000),
            category: this.extractCategory(content || pdfText),
            tags: this.extractTags(content || pdfText),
            rawResponse: content,
            confidence: 0.7
          };
        }
      } catch (aiError) {
        return {
          extractedText: pdfText.substring(0, 5000),
          category: this.extractCategory(pdfText),
          tags: this.extractTags(pdfText),
          metadata: {
            textLength: pdfText.length,
            aiTimeoutFallback: true,
            aiError: aiError instanceof Error ? aiError.message : String(aiError)
          },
          confidence: 0.65
        };
      }
    } catch (error) {
      console.error('Error analyzing PDF:', error);
      return {
        extractedText: '',
        category: 'Sonstiges',
        tags: [],
        metadata: {
          pdfReadError: true,
          error: error instanceof Error ? error.message : String(error)
        },
        confidence: 0.2
      };
    }
  }
  
  /**
   * Textdatei analysieren
   */
  private async analyzeText(filePath: string): Promise<Partial<AnalysisResult>> {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: 'qwen/qwen3.5-397b-a17b',
          messages: [
            {
              role: 'user',
              content: `Analysiere diesen Text und extrahiere:
1. Dokumenttyp
2. Wichtige Informationen
3. Kategorie
4. Tags

Text:
${text.substring(0, 8000)}

Antworte JSON:
{
  "documentType": "...",
  "extractedInfo": {...},
  "category": "...",
  "tags": [...]
}`
            }
          ],
          temperature: 0.2,
          max_tokens: 2048
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );
      
      const content = response.data.choices[0]?.message?.content || '';
      
      try {
        const parsed = JSON.parse(content);
        return {
          extractedText: text,
          category: parsed.category,
          tags: parsed.tags,
          metadata: {
            documentType: parsed.documentType,
            extractedInfo: parsed.extractedInfo,
            textLength: text.length
          },
          rawResponse: content,
          confidence: 0.9
        };
      } catch {
        return {
          extractedText: text,
          category: this.extractCategory(content),
          tags: this.extractTags(content),
          rawResponse: content,
          confidence: 0.7
        };
      }
    } catch (error) {
      console.error('Error analyzing text:', error);
      return {
        extractedText: 'Fehler bei der Textanalyse',
        category: 'fehler',
        confidence: 0
      };
    }
  }
  
  /**
   * Text aus PDF extrahieren (Basis-Implementation)
   */
  private async extractTextFromPdf(filePath: string): Promise<string> {
    const pdfjsLib = await import('pdfjs-dist');
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfData = new Uint8Array(pdfBuffer);
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    
    let fullText = '';
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText;
  }
  
  /**
   * Kategorie aus Response extrahieren
   */
  private extractCategory(text: string): string {
    const lower = text.toLowerCase();
    const categories = [
      'rechnung', 'quittung', 'vertrag', 'angebot', 'lieferchein',
      'gutschrift', 'lastschrift', 'überweisung', 'beleg', 'dokument'
    ];
    
    for (const cat of categories) {
      if (lower.includes(cat)) {
        return cat;
      }
    }
    
    return 'sonstiges';
  }
  
  /**
   * Tags aus Response extrahieren
   */
  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const lower = text.toLowerCase();
    
    const keywords = [
      'rechnung', 'quittung', 'vertrag', 'steuer', 'mehrwertsteuer',
      'betrag', 'datum', 'firma', 'adresse', 'iban', 'bic',
      'zahlung', 'bar', 'karte', 'online', 'amazon', ' ebay'
    ];
    
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        tags.push(keyword);
      }
    }
    
    return tags.slice(0, 10);
  }
  
  /**
   * Datei kategorisieren basierend auf Analyse
   */
  categorizeFile(analysis: AnalysisResult): string {
    const category = analysis.category?.toLowerCase() || '';
    const tags = analysis.tags || [];
    const fileName = analysis.fileName.toLowerCase();
    
    if (category.includes('rechnung') || tags.includes('rechnung')) {
      return 'Rechnungen';
    }
    if (category.includes('quittung') || tags.includes('quittung')) {
      return 'Quittungen';
    }
    if (category.includes('vertrag') || tags.includes('vertrag')) {
      return 'Vertraege';
    }
    if (category.includes('angebot')) {
      return 'Angebote';
    }
    if (fileName.includes('rechnung') || fileName.includes('invoice')) {
      return 'Rechnungen';
    }
    if (fileName.includes('quittung') || fileName.includes('receipt')) {
      return 'Quittungen';
    }
    
    return 'Sonstiges';
  }
}
