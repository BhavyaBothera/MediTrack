import { supabaseAdmin } from '../config/supabase';
import { Prescription } from '../types';

export class PrescriptionService {
  /**
   * Upload prescription document to Supabase storage bucket and save metadata
   */
  async createPrescription(patientId: string, file: Express.Multer.File, metadata: {
    doctorName?: string;
    prescriptionDate?: string;
    validUntil?: string;
    diagnosis?: string;
    notes?: string;
  }): Promise<Prescription> {
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${patientId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    // Upload to Supabase Storage 'prescriptions' bucket
    const { data: uploadData, error: uploadError } = await supabaseAdmin
      .storage
      .from('prescriptions')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Prescription] Upload error:', uploadError);
      // Fallback: file url placeholder if bucket not created yet
    }

    const fileUrl = uploadData ? uploadData.path : fileName;

    // Simulate OCR assistant text extraction (rules-based regex extractor)
    const ocrResult = this.simulateOcrExtraction(file.originalname, metadata.notes || '');

    // Insert prescription record
    const { data: pres, error: presError } = await supabaseAdmin
      .from('prescriptions')
      .insert({
        patient_id: patientId,
        doctor_name: metadata.doctorName || null,
        prescription_date: metadata.prescriptionDate || new Date().toISOString().split('T')[0],
        valid_until: metadata.validUntil || null,
        diagnosis: metadata.diagnosis || null,
        file_url: fileUrl,
        file_name: file.originalname,
        file_type: file.mimetype,
        file_size: file.size,
        notes: metadata.notes || null,
        ocr_extracted_text: ocrResult.extractedText,
        ocr_data: ocrResult.suggestions,
        status: 'active',
      })
      .select('*')
      .single();

    if (presError || !pres) {
      throw new Error(`Failed to save prescription: ${presError?.message}`);
    }

    return pres;
  }

  /**
   * Generates a secure, temporary signed URL for viewing private prescription document
   */
  async getSecureViewUrl(filePath: string): Promise<string> {
    const { data, error } = await supabaseAdmin
      .storage
      .from('prescriptions')
      .createSignedUrl(filePath, 3600); // 1 hour validity

    if (error || !data) {
      return '';
    }

    return data.signedUrl;
  }

  /**
   * List prescriptions for patient
   */
  async getPrescriptions(patientId: string): Promise<any[]> {
    const { data, error } = await supabaseAdmin
      .from('prescriptions')
      .select('*, prescription_revisions (*)')
      .eq('patient_id', patientId)
      .order('prescription_date', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Helper: rule-based OCR extraction assistant
   * Note: The application is an assistance tool; human verification is always strictly required.
   */
  private simulateOcrExtraction(filename: string, notes: string): { extractedText: string; suggestions: any[] } {
    const sampleText = notes.length > 5 ? notes : `Prescription Document: ${filename}\nRx: Paracetamol 500mg, 1 tablet twice daily after food.\nRx: Metformin 500mg, 1 tablet once daily with food.\nRx: Atorvastatin 20mg, 1 tablet at night.`;
    
    // Extract medication patterns
    const regex = /(?:Rx:\s*)?([A-Za-z]+)\s+(\d+\s*(?:mg|g|ml))\b/gi;
    const suggestions: any[] = [];
    let match;

    while ((match = regex.exec(sampleText)) !== null) {
      suggestions.push({
        name: match[1],
        dosage: match[2],
        units: 1,
        frequency: 'once_daily',
        foodTiming: 'after_food',
      });
    }

    return {
      extractedText: sampleText,
      suggestions,
    };
  }
}

export const prescriptionService = new PrescriptionService();

