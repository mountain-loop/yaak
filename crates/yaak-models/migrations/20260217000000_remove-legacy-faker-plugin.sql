-- Remove stale plugin rows left over from the brief period when faker shipped as bundled.
DELETE FROM plugins
WHERE directory LIKE '%template-function-faker';
