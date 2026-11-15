import { supabaseAdmin } from '../config/supabase';

export interface AdherenceMetrics {
  totalScheduled: number;
  totalTaken: number;
  totalOverdue: number;
  totalMissed: number;
  totalSkipped: number;
  adherencePercentage: number;
  averageConfirmationDelayMinutes: number;
  dailyTrends: Array<{ date: string; scheduled: number; taken: number; percentage: number }>;
  medicineBreakdown: Array<{
    medicineId: string;
    medicineName: string;
    scheduled: number;
    taken: number;
    percentage: number;
  }>;
}

export class AnalyticsService {
  async getAdherenceAnalytics(patientId: string, days = 30): Promise<AdherenceMetrics> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Fetch doses within range
    const { data: doses, error } = await supabaseAdmin
      .from('scheduled_doses')
      .select(`
        id,
        scheduled_date,
        scheduled_time,
        scheduled_timestamp,
        status,
        confirmed_at,
        dose_quantity,
        medicine_id,
        medicines (
          id,
          name
        )
      `)
      .eq('patient_id', patientId)
      .gte('scheduled_date', startDateStr);

    if (error || !doses) {
      console.error('[AnalyticsService] Error:', error);
      return {
        totalScheduled: 0,
        totalTaken: 0,
        totalOverdue: 0,
        totalMissed: 0,
        totalSkipped: 0,
        adherencePercentage: 100,
        averageConfirmationDelayMinutes: 0,
        dailyTrends: [],
        medicineBreakdown: [],
      };
    }

    let totalScheduled = doses.length;
    let totalTaken = 0;
    let totalOverdue = 0;
    let totalMissed = 0;
    let totalSkipped = 0;
    let totalDelayMinutes = 0;
    let delayCount = 0;

    const dailyMap: Record<string, { scheduled: number; taken: number }> = {};
    const medMap: Record<string, { name: string; scheduled: number; taken: number }> = {};

    for (const d of doses) {
      if (d.status === 'taken') totalTaken++;
      else if (d.status === 'overdue') totalOverdue++;
      else if (d.status === 'missed') totalMissed++;
      else if (d.status === 'skipped') totalSkipped++;

      // Compute delay
      if (d.status === 'taken' && d.confirmed_at && d.scheduled_timestamp) {
        const schedTime = new Date(d.scheduled_timestamp).getTime();
        const confTime = new Date(d.confirmed_at).getTime();
        const diffMinutes = Math.max(0, Math.round((confTime - schedTime) / 60000));
        totalDelayMinutes += diffMinutes;
        delayCount++;
      }

      // Group by date
      if (!dailyMap[d.scheduled_date]) {
        dailyMap[d.scheduled_date] = { scheduled: 0, taken: 0 };
      }
      dailyMap[d.scheduled_date].scheduled++;
      if (d.status === 'taken') dailyMap[d.scheduled_date].taken++;

      // Group by medicine
      const medName = (d as any).medicines?.name || 'Unknown';
      if (!medMap[d.medicine_id]) {
        medMap[d.medicine_id] = { name: medName, scheduled: 0, taken: 0 };
      }
      medMap[d.medicine_id].scheduled++;
      if (d.status === 'taken') medMap[d.medicine_id].taken++;
    }

    const adherencePercentage = totalScheduled > 0 ? Math.round((totalTaken / totalScheduled) * 100) : 100;
    const averageConfirmationDelayMinutes = delayCount > 0 ? Math.round(totalDelayMinutes / delayCount) : 0;

    // Format daily trends
    const dailyTrends = Object.keys(dailyMap).sort().map(date => {
      const item = dailyMap[date];
      return {
        date,
        scheduled: item.scheduled,
        taken: item.taken,
        percentage: item.scheduled > 0 ? Math.round((item.taken / item.scheduled) * 100) : 100,
      };
    });

    // Format medicine breakdown
    const medicineBreakdown = Object.keys(medMap).map(medId => {
      const item = medMap[medId];
      return {
        medicineId: medId,
        medicineName: item.name,
        scheduled: item.scheduled,
        taken: item.taken,
        percentage: item.scheduled > 0 ? Math.round((item.taken / item.scheduled) * 100) : 100,
      };
    });

    return {
      totalScheduled,
      totalTaken,
      totalOverdue,
      totalMissed,
      totalSkipped,
      adherencePercentage,
      averageConfirmationDelayMinutes,
      dailyTrends,
      medicineBreakdown,
    };
  }
}

export const analyticsService = new AnalyticsService();

