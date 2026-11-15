import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '../config/supabase';
import { analyticsService } from './analyticsService';

export class ReportService {
  /**
   * Generates a CSV string for dose records
   */
  async generateDoseHistoryCSV(patientId: string, days = 30): Promise<string> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const { data: doses } = await supabaseAdmin
      .from('scheduled_doses')
      .select(`
        scheduled_date,
        scheduled_time,
        status,
        dose_quantity,
        confirmed_at,
        skip_reason,
        medicines (name, brand_name, prescribed_dosage, food_timing)
      `)
      .eq('patient_id', patientId)
      .gte('scheduled_date', startDateStr)
      .order('scheduled_date', { ascending: false });

    const headers = [
      'Date',
      'Time',
      'Medicine Name',
      'Brand Name',
      'Dosage',
      'Quantity',
      'Food Timing',
      'Status',
      'Confirmed At',
      'Notes / Reason',
    ];

    const rows = (doses || []).map(d => {
      const med = (d as any).medicines || {};
      return [
        d.scheduled_date,
        d.scheduled_time,
        `"${med.name || ''}"`,
        `"${med.brand_name || ''}"`,
        `"${med.prescribed_dosage || ''}"`,
        d.dose_quantity,
        med.food_timing || '',
        d.status,
        d.confirmed_at || '',
        `"${(d.skip_reason || '').replace(/"/g, '""')}"`,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Generates a PDF adherence report and pipes to stream
   */
  async generateAdherencePDF(patientId: string, patientName: string, days = 30): Promise<Buffer> {
    const metrics = await analyticsService.getAdherenceAnalytics(patientId, days);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc.fontSize(22).fillColor('#1e40af').text('MediTrack – Medication Adherence Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#64748b').text(`Generated on: ${new Date().toLocaleString()} | Period: Last ${days} Days`, { align: 'center' });
      doc.moveDown(1.5);

      // Patient Info Box
      doc.rect(50, 110, 500, 60).fill('#f8fafc').stroke('#cbd5e1');
      doc.fillColor('#0f172a').fontSize(12).text(`Patient Name: ${patientName}`, 65, 122);
      doc.fontSize(10).fillColor('#475569').text(`Patient ID: ${patientId}`, 65, 142);
      doc.moveDown(3);

      // Key Metrics Summary
      doc.fontSize(14).fillColor('#1e40af').text('Overall Adherence Summary');
      doc.moveDown(0.5);

      const y = 200;
      doc.fontSize(11).fillColor('#0f172a');
      doc.text(`Total Scheduled Doses: ${metrics.totalScheduled}`, 65, y);
      doc.text(`Confirmed / Taken Doses: ${metrics.totalTaken}`, 65, y + 20);
      doc.text(`Overdue Doses: ${metrics.totalOverdue}`, 65, y + 40);
      doc.text(`Missed Confirmations: ${metrics.totalMissed}`, 300, y);
      doc.text(`Skipped Doses: ${metrics.totalSkipped}`, 300, y + 20);
      doc.text(`Adherence Rate: ${metrics.adherencePercentage}%`, 300, y + 40);
      doc.moveDown(4);

      // Medicine-wise table
      doc.fontSize(14).fillColor('#1e40af').text('Medicine Breakdown');
      doc.moveDown(0.5);

      let tableY = doc.y;
      doc.fontSize(10).fillColor('#475569');
      doc.text('Medicine Name', 65, tableY);
      doc.text('Scheduled', 260, tableY);
      doc.text('Taken', 350, tableY);
      doc.text('Adherence %', 440, tableY);

      doc.moveTo(50, tableY + 15).lineTo(550, tableY + 15).stroke('#cbd5e1');
      tableY += 25;

      for (const med of metrics.medicineBreakdown) {
        if (tableY > 700) {
          doc.addPage();
          tableY = 50;
        }
        doc.fillColor('#0f172a');
        doc.text(med.medicineName, 65, tableY);
        doc.text(String(med.scheduled), 260, tableY);
        doc.text(String(med.taken), 350, tableY);
        doc.text(`${med.percentage}%`, 440, tableY);
        tableY += 20;
      }

      // Disclaimer
      doc.fontSize(8).fillColor('#94a3b8').text(
        'MediTrack is a medication tracking tool, not a diagnostic or prescribing system. Consult your healthcare provider before altering dosages.',
        50,
        720,
        { align: 'center', width: 500 }
      );

      doc.end();
    });
  }
}

export const reportService = new ReportService();

