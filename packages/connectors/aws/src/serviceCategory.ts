/**
 * Best-effort mapping from AWS service names (as returned by Cost Explorer) to a
 * coarse FOCUS ServiceCategory. Unrecognized services fall back to "Other" rather
 * than failing the sync — this list is meant to grow over time, not be exhaustive.
 */
const CATEGORY_BY_KEYWORD: Array<[RegExp, string]> = [
  [/EC2|Lambda|Lightsail|Fargate|Batch|Elastic Beanstalk/i, "Compute"],
  [/S3|EBS|EFS|Glacier|Storage Gateway|FSx/i, "Storage"],
  [/RDS|DynamoDB|ElastiCache|Neptune|DocumentDB|Redshift/i, "Database"],
  [/VPC|CloudFront|Route 53|Direct Connect|Elastic Load Balancing|Transit Gateway/i, "Networking"],
  [/CloudWatch|X-Ray|CloudTrail|Config/i, "Observability"],
  [/SageMaker|Comprehend|Rekognition|Textract|Bedrock/i, "AI/ML"],
  [/Glue|EMR|Athena|Kinesis|Data Pipeline|Lake Formation/i, "Analytics"],
  [/IAM|KMS|Secrets Manager|Security Hub|GuardDuty|WAF|Shield/i, "Security"],
  [/Tax/i, "Tax"],
];

export function inferServiceCategory(awsServiceName: string): string {
  for (const [pattern, category] of CATEGORY_BY_KEYWORD) {
    if (pattern.test(awsServiceName)) return category;
  }
  return "Other";
}
