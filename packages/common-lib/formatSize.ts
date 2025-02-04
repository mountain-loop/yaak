export function formatSize(bytes: number): string {
    let num;
    let unit;

    if (bytes > 1000 * 1000 * 1000) {
        num = bytes / 1000 / 1000 / 1000;
        unit = 'GB';
    } else if (bytes > 1000 * 1000) {
        num = bytes / 1000 / 1000;
        unit = 'MB';
    } else if (bytes > 1000) {
        num = bytes / 1000;
        unit = 'KB';
    } else {
        num = bytes;
        unit = 'B';
    }

    return `${Math.round(num * 10) / 10} ${unit}`;
}
