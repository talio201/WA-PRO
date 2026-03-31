/**
 * Checks if the current time is within the campaign's delivery window.
 * Uses native Intl for timezone handling.
 * @param {Object} campaign - The campaign object containing antiBan.deliveryWindow.
 * @returns {Boolean} - True if allowed to send, false otherwise.
 */
function isWithinDeliveryWindow(campaign) {
  if (!campaign || !campaign.antiBan || !campaign.antiBan.deliveryWindow) {
    return true; 
  }

  const { enabled, startTime, endTime, daysOfWeek, timezone = 'America/Sao_Paulo' } = campaign.antiBan.deliveryWindow;

  if (!enabled) {
    return true;
  }

  const now = new Date();

  // Get current weekday in target timezone (numeric 0-6 or string)
  // Note: Intl weekday 'numeric' returns 1-7 (typically where 1=Monday or 7=Sunday depending on locale)
  // Let's use a more robust way to get current hour and minute in timezone
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short'
  });

  const parts = formatter.formatToParts(now);
  const info = {};
  parts.forEach(p => info[p.type] = p.value);

  const currentTimeStr = `${info.hour}:${info.minute}`;
  
  // Mapping standard weekdays to 0-6
  const dayMap = { 'dom': 0, 'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5, 'sáb': 6, 'sab': 6 };
  const currentDayStr = String(info.weekday || '').toLowerCase().slice(0, 3);
  const currentDay = dayMap[currentDayStr] ?? now.getDay(); 

  // Day of week check
  if (Array.isArray(daysOfWeek) && daysOfWeek.length > 0) {
    if (!daysOfWeek.map(Number).includes(currentDay)) {
      return false;
    }
  }

  // Time window check (HH:mm)
  if (startTime && currentTimeStr < startTime) {
    return false;
  }
  if (endTime && currentTimeStr > endTime) {
    return false;
  }

  return true;
}

module.exports = {
  isWithinDeliveryWindow,
};
