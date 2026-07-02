import classNames from "classnames";
import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  formatDistanceToNowStrict,
  isToday,
  isYesterday,
} from "date-fns";

interface Props {
  className?: string;
  timestamp: Date | string;
}

const TIMEZONE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/;

export function RelativeTime({ className, timestamp }: Props) {
  const date = parseTimestamp(timestamp);

  return (
    <time
      className={classNames("text-text-subtle", className)}
      dateTime={date.toISOString()}
      title={format(date, "MMM d, yyyy, h:mm:ss a O")}
    >
      {formatRelativeTime(timestamp)}
    </time>
  );
}

export function formatRelativeTime(timestamp: Date | string) {
  return `${formatDistanceToNowStrict(parseTimestamp(timestamp))} ago`;
}

export function formatAbsoluteTime(timestamp: Date | string) {
  return format(parseTimestamp(timestamp), "MMM d, yyyy, h:mm:ss a O");
}

export function formatRelativeTimeGroup(timestamp: Date | string) {
  const date = parseTimestamp(timestamp);
  const now = new Date();
  const minutesAgo = differenceInMinutes(now, date);
  const hoursAgo = differenceInHours(now, date);

  if (minutesAgo < 5) {
    return "Just now";
  }

  if (minutesAgo < 15) {
    return "5 minutes ago";
  }

  if (minutesAgo < 60) {
    return "15 minutes ago";
  }

  if (hoursAgo < 3) {
    return "1 hour ago";
  }

  if (hoursAgo < 6) {
    return "3 hours ago";
  }

  if (isToday(date)) {
    return "Today";
  }

  if (isYesterday(date)) {
    return "Yesterday";
  }

  if (differenceInCalendarDays(now, date) < 7) {
    return "This week";
  }

  if (date.getFullYear() === now.getFullYear()) {
    return format(date, "MMM d");
  }

  return format(date, "MMM d, yyyy");
}

export function parseTimestamp(timestamp: Date | string) {
  return timestamp instanceof Date ? timestamp : new Date(normalizeTimestamp(timestamp));
}

function normalizeTimestamp(timestamp: string) {
  return TIMEZONE_PATTERN.test(timestamp) ? timestamp : `${timestamp}Z`;
}
