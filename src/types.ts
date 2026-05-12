export interface Vacancy {
  id: number;
  title: string;
  description: string;
  is_active: boolean;
}

export interface Question {
  id: number;
  vacancy_id: number;
  order_num: number;
  text: string;
  criteria: string;
}

export interface AnswerRecord {
  question_id: number;
  question: string;
  text: string;
  score: number;
  comment: string;
}

export type Recommendation = "Нанять" | "Доп.интервью" | "Отказать";

export interface InterviewResult {
  id: number;
  candidate_name: string;
  candidate_tg: string;
  vacancy_id: number;
  vacancy_title: string;
  answers: AnswerRecord[];
  total_score: number;
  ai_summary: string;
  recommendation: Recommendation;
  status: "completed" | "incomplete";
  created_at: Date;
}

export interface InterviewSession {
  vacancyId: number;
  vacancyTitle: string;
  questions: Question[];
  currentStep: number;
  answers: Record<number, AnswerRecord>;
  candidateName: string;
  startedAt: number;
  state: "awaiting_name" | "ready_to_start" | "in_progress" | "completed";
}

export interface Evaluation {
  score: number;
  comment: string;
}

export interface Summary {
  summary: string;
  recommendation: Recommendation;
  totalScore: number;
}
