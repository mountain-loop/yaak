UPDATE http_requests
SET authentication_type = 'awsv4'
WHERE authentication_type = 'auth-aws-sig-v4';

UPDATE folders
SET authentication_type = 'awsv4'
WHERE authentication_type = 'auth-aws-sig-v4';

UPDATE workspaces
SET authentication_type = 'awsv4'
WHERE authentication_type = 'auth-aws-sig-v4';
