export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DifficultyLevel = "introductory" | "standard" | "advanced";
export type MaterialState = "unverified" | "verified" | "discarded";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string; is_demo: boolean; created_at: string };
        Insert: { id: string; display_name: string; is_demo?: boolean; created_at?: string };
        Update: { id?: string; display_name?: string; is_demo?: boolean; created_at?: string };
        Relationships: [];
      };
      students: {
        Row: {
          id: string; owner_id: string; alias: string; current_level: string | null;
          learning_goal: string | null; active: boolean; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; owner_id: string; alias: string; current_level?: string | null;
          learning_goal?: string | null; active?: boolean; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; owner_id?: string; alias?: string; current_level?: string | null;
          learning_goal?: string | null; active?: boolean; created_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string; student_id: string; session_date: string; topic: string; understanding: number;
          summary: string; difficulty_notes: string | null; next_goal: string | null;
          private_notes: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; student_id: string; session_date: string; topic: string; understanding: number;
          summary: string; difficulty_notes?: string | null; next_goal?: string | null;
          private_notes?: string | null; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; student_id?: string; session_date?: string; topic?: string; understanding?: number;
          summary?: string; difficulty_notes?: string | null; next_goal?: string | null;
          private_notes?: string | null; created_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
      materials: {
        Row: {
          id: string; student_id: string; session_id: string | null; topic: string;
          difficulty: DifficultyLevel; state: MaterialState; ai_draft: Json;
          verified_content: Json | null; discard_reason: string | null; prompt_version: string;
          model_label: string; verified_at: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; student_id: string; session_id?: string | null; topic: string;
          difficulty: DifficultyLevel; state?: MaterialState; ai_draft: Json;
          verified_content?: Json | null; discard_reason?: string | null; prompt_version: string;
          model_label: string; verified_at?: string | null; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; student_id?: string; session_id?: string | null; topic?: string;
          difficulty?: DifficultyLevel; state?: MaterialState; ai_draft?: Json;
          verified_content?: Json | null; discard_reason?: string | null; prompt_version?: string;
          model_label?: string; verified_at?: string | null; created_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
      generation_runs: {
        Row: {
          id: string; material_id: string | null; owner_id: string; model_label: string;
          prompt_version: string; latency_ms: number; success: boolean;
          validation_error: string | null; created_at: string;
        };
        Insert: {
          id?: string; material_id?: string | null; owner_id: string; model_label: string;
          prompt_version: string; latency_ms: number; success: boolean;
          validation_error?: string | null; created_at?: string;
        };
        Update: {
          id?: string; material_id?: string | null; owner_id?: string; model_label?: string;
          prompt_version?: string; latency_ms?: number; success?: boolean;
          validation_error?: string | null; created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      seed_demo_workspace: { Args: { demo_id: string }; Returns: undefined };
    };
    Enums: { difficulty_level: DifficultyLevel; material_state: MaterialState };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Student = Database["public"]["Tables"]["students"]["Row"];
export type Session = Database["public"]["Tables"]["sessions"]["Row"];
export type Material = Database["public"]["Tables"]["materials"]["Row"];
export type GenerationRun = Database["public"]["Tables"]["generation_runs"]["Row"];
