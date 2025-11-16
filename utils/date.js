/**
 * Parses a date string in "yyyyMMdd" format.
 */
function parseYYYYMMDD(dateString) {
    if (dateString.length === 8) {
        const year = parseInt(dateString.slice(0, 4), 10);
        const month = parseInt(dateString.slice(4, 6), 10);
        const day = parseInt(dateString.slice(6, 8), 10);
        return new Date(year, month - 1, day);
    }
    return new Date(dateString); // Fallback
}

/**
 * Parses a date string from a filename (YYYYMMDDHHmmss) into a Date object.
 */
export function parseDate(dateString) {
    if (dateString.length !== 14) return null;
    const year = parseInt(dateString.substring(0, 4), 10);
    const month = parseInt(dateString.substring(4, 6), 10) - 1; // 0-indexed
    const day = parseInt(dateString.substring(6, 8), 10);
    const hour = parseInt(dateString.substring(8, 10), 10);
    const minute = parseInt(dateString.substring(10, 12), 10);
    const second = parseInt(dateString.substring(12, 14), 10);
    
    const date = new Date(Date.UTC(year, month, day, hour, minute, second));
    return isNaN(date.getTime()) ? null : date;
}

/**
 * Formats an ISO string for use in filenames (YYYYMMDDHHmmss).
 */
export const formatDateForFilename = (isoString) => {
    const d = new Date(isoString);
    return [
        d.getUTCFullYear(),
        (d.getUTCMonth() + 1).toString().padStart(2, '0'),
        d.getUTCDate().toString().padStart(2, '0'),
        d.getUTCHours().toString().padStart(2, '0'),
        d.getUTCMinutes().toString().padStart(2, '0'),
        d.getUTCSeconds().toString().padStart(2, '0'),
    ].join('');
};

/**
 * Convert a Date object to an ISO8601 string with a fixed +08:00 offset.
 */
export function formatDateTimeWithOffset(dt) {
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    const hour = String(dt.getHours()).padStart(2, '0');
    const minute = String(dt.getMinutes()).padStart(2, '0');
    const second = String(dt.getSeconds()).padStart(2, '0');
    const offset = "+08:00"; // Hardcoded offset
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

/**
 * Parses a date/time string with specific format handling.
 */
export function parseDateTime(dateString, dateFormat, japanTime = false) {
    let dt;

    if (dateFormat === "yyyyMMdd") {
        dt = parseYYYYMMDD(dateString);
    } else {
        const normalized = dateString.replace(/\./g, "/");
        dt = new Date(normalized);
    }

    if (isNaN(dt.getTime())) {
        console.error(`Unable to convert '${dateString}' with format '${dateFormat}'.`);
        return null;
    }

    if (japanTime) {
        dt.setHours(dt.getHours() - 1);
    }

    return formatDateTimeWithOffset(dt);
}