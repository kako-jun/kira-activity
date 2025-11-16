/**
 * Process activity data for Death Note L-style visualization
 * Converts raw activity data into 4 visualization steps
 */

export class DataProcessor {
  /**
   * Process GitHub or Hatena activity data
   * @param {Object} activityData - Raw activity data
   * @returns {Object} Processed data for 4 visualization steps
   */
  static process(activityData) {
    const events = activityData.events || [];

    return {
      step1: this.generateRandomList(events),
      step2: this.generateCalendarView(events),
      step3: this.generateWeeklyView(events),
      step4: this.generate3DView(events),
      metadata: {
        username: activityData.username,
        totalEvents: events.length,
        dateRange: this.getDateRange(events)
      }
    };
  }

  /**
   * Step 1: Random list of activities (scattered, unorganized)
   * Mimics the initial chaotic view before L's analysis
   */
  static generateRandomList(events) {
    const shuffled = [...events].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 50).map(event => ({
      type: event.type,
      date: new Date(event.date),
      timestamp: new Date(event.date).getTime(),
      repo: event.repo || event.url || 'activity',
      message: event.message || event.title || event.comment || 'Activity'
    }));
  }

  /**
   * Step 2: Calendar view (date × hour matrix)
   * Shows activity distributed across days and hours
   * Also groups by week for the layering animation
   */
  static generateCalendarView(events) {
    const calendar = {};
    const weeklyCalendars = [];

    events.forEach(event => {
      const date = new Date(event.date);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const hour = date.getHours();

      if (!calendar[dateKey]) {
        calendar[dateKey] = Array(24).fill(0);
      }
      calendar[dateKey][hour]++;
    });

    // Group calendar by weeks for layering animation
    const dates = Object.keys(calendar).sort();
    if (dates.length > 0) {
      let currentWeek = [];
      let currentWeekStart = new Date(dates[0]);

      dates.forEach(dateKey => {
        const date = new Date(dateKey);
        const daysSinceStart = Math.floor((date - currentWeekStart) / (1000 * 60 * 60 * 24));

        if (daysSinceStart >= 7) {
          // Start new week
          if (currentWeek.length > 0) {
            weeklyCalendars.push([...currentWeek]);
          }
          currentWeek = [];
          currentWeekStart = date;
        }

        const dayOfWeek = date.getDay();
        currentWeek.push({
          date: dateKey,
          dayOfWeek: dayOfWeek,
          hours: calendar[dateKey]
        });
      });

      // Add last week
      if (currentWeek.length > 0) {
        weeklyCalendars.push(currentWeek);
      }
    }

    return {
      full: calendar,
      weeks: weeklyCalendars
    };
  }

  /**
   * Step 3: Weekly aggregation (day of week bar chart)
   * Mimics L's analysis showing activity patterns by day of week
   */
  static generateWeeklyView(events) {
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekly = weekdays.map(day => ({ day, count: 0 }));

    events.forEach(event => {
      const date = new Date(event.date);
      const dayIndex = date.getDay();
      weekly[dayIndex].count++;
    });

    return weekly;
  }

  /**
   * Step 4: 3D view (day of week × hour × count)
   * Full 3D bar chart showing patterns across week and time
   */
  static generate3DView(events) {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const grid = [];

    // Initialize 7 days × 24 hours grid
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        grid.push({
          day: weekdays[day],
          dayIndex: day,
          hour: hour,
          count: 0
        });
      }
    }

    // Count events
    events.forEach(event => {
      const date = new Date(event.date);
      const dayIndex = date.getDay();
      const hour = date.getHours();
      const index = dayIndex * 24 + hour;
      grid[index].count++;
    });

    return grid;
  }

  /**
   * Get date range of events
   */
  static getDateRange(events) {
    if (events.length === 0) {
      return { start: null, end: null };
    }

    const dates = events.map(e => new Date(e.date).getTime());
    return {
      start: new Date(Math.min(...dates)).toISOString(),
      end: new Date(Math.max(...dates)).toISOString()
    };
  }

  /**
   * Get activity statistics
   */
  static getStats(events) {
    const total = events.length;
    const byType = {};

    events.forEach(event => {
      byType[event.type] = (byType[event.type] || 0) + 1;
    });

    return {
      total,
      byType,
      averagePerDay: this.getAveragePerDay(events)
    };
  }

  /**
   * Calculate average activities per day
   */
  static getAveragePerDay(events) {
    if (events.length === 0) return 0;

    const range = this.getDateRange(events);
    const days = (new Date(range.end) - new Date(range.start)) / (1000 * 60 * 60 * 24);
    return days > 0 ? (events.length / days).toFixed(2) : 0;
  }
}
