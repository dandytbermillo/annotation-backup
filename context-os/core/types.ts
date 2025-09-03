/**
 * Core type definitions for Context-OS
 */

export enum Status {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  TESTING = 'TESTING',
  COMPLETE = 'COMPLETE',
  BLOCKED = 'BLOCKED',
  ROLLBACK = 'ROLLBACK'
}

export enum Severity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export interface FeaturePlan {
  title: string;
  slug?: string;
  date: string;
  status: Status;
  author?: string;
  objective: string;
  background?: string;
  acceptanceCriteria: string[];
  implementationTasks: string[];
  technicalApproach?: string;
  dependencies?: string[];
  risks?: string[];
  successMetrics?: string[];
  outOfScope?: string[];
  notes?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
  missingFields: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface FeatureStructure {
  basePath: string;
  slug: string;
  directories: string[];
  files: FileTemplate[];
}

export interface FileTemplate {
  path: string;
  content: string;
}

export interface AgentContext {
  plan: FeaturePlan;
  basePath: string;
  verbose: boolean;
  skipValidation?: boolean;
}

export interface AgentResult {
  success: boolean;
  message: string;
  data?: any;
  errors?: string[];
}

export interface ConfirmationOptions {
  message: string;
  default?: boolean;
  actions: string[];
}

export interface SeverityMetrics {
  performanceImpact?: number;  // Percentage
  memoryGrowth?: number;       // Percentage per 24h
  usersAffected?: number;      // Percentage
  environment: 'production' | 'staging' | 'development';
}

export interface FixReport {
  title: string;
  date: string;
  severity: Severity;
  status: 'resolved' | 'in_progress' | 'blocked';
  metrics: SeverityMetrics;
  problem: string;
  rootCause: string[];
  solution: string;
  filesModified: string[];
  verification: string[];
  learnings: string[];
}

export interface TestResult {
  command: string;
  output: string;
  exitCode: number;
  duration: number;
  timestamp: string;
}

export abstract class Agent {
  protected context: AgentContext;
  
  constructor(context: AgentContext) {
    this.context = context;
  }
  
  abstract execute(): Promise<AgentResult>;
  abstract validate(): ValidationResult;
}