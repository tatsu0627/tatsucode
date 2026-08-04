export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DifficultyLevel = "introductory" | "standard" | "advanced";
export type MaterialState = "unverified" | "verified" | "discarded";
export type MaterialKind = "practice" | "probe";
export type ProbeResult = "solved" | "failed" | "skipped";

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
      concepts: {
        Row: {
          id: string; code: string; label: string; description: string; depth: number;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; code: string; label: string; description?: string; depth: number;
          created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; code?: string; label?: string; description?: string; depth?: number;
          created_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
      concept_edges: {
        Row: { prerequisite_id: string; dependent_id: string; created_at: string };
        Insert: { prerequisite_id: string; dependent_id: string; created_at?: string };
        Update: { prerequisite_id?: string; dependent_id?: string; created_at?: string };
        Relationships: [];
      };
      consultations: {
        Row: {
          id: string; student_id: string; target_concept_id: string | null;
          root_blocker_concept_id: string | null; consultation_date: string; topic: string;
          summary: string; private_notes: string | null; completed_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; student_id: string; target_concept_id?: string | null;
          root_blocker_concept_id?: string | null; consultation_date?: string; topic: string;
          summary?: string; private_notes?: string | null; completed_at?: string | null;
          created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; student_id?: string; target_concept_id?: string | null;
          root_blocker_concept_id?: string | null; consultation_date?: string; topic?: string;
          summary?: string; private_notes?: string | null; completed_at?: string | null;
          created_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
      materials: {
        Row: {
          id: string; student_id: string; concept_id: string | null; kind: MaterialKind;
          topic: string; difficulty: DifficultyLevel; state: MaterialState; ai_draft: Json;
          verified_content: Json | null; discard_reason: string | null; prompt_version: string;
          model_label: string; verified_at: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; student_id: string; concept_id?: string | null; kind?: MaterialKind;
          topic: string; difficulty: DifficultyLevel; state?: MaterialState; ai_draft: Json;
          verified_content?: Json | null; discard_reason?: string | null; prompt_version: string;
          model_label: string; verified_at?: string | null; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; student_id?: string; concept_id?: string | null; kind?: MaterialKind;
          topic?: string; difficulty?: DifficultyLevel; state?: MaterialState; ai_draft?: Json;
          verified_content?: Json | null; discard_reason?: string | null; prompt_version?: string;
          model_label?: string; verified_at?: string | null; created_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
      probes: {
        Row: {
          id: string; consultation_id: string; concept_id: string; material_id: string;
          material_state: MaterialState; result: ProbeResult; step: number; created_at: string;
        };
        Insert: {
          id?: string; consultation_id: string; concept_id: string; material_id: string;
          material_state?: MaterialState; result: ProbeResult; step: number; created_at?: string;
        };
        Update: {
          id?: string; consultation_id?: string; concept_id?: string; material_id?: string;
          material_state?: MaterialState; result?: ProbeResult; step?: number; created_at?: string;
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
    Enums: {
      difficulty_level: DifficultyLevel;
      material_state: MaterialState;
      material_kind: MaterialKind;
      probe_result: ProbeResult;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Student = Database["public"]["Tables"]["students"]["Row"];
export type Concept = Database["public"]["Tables"]["concepts"]["Row"];
export type ConceptEdge = Database["public"]["Tables"]["concept_edges"]["Row"];
export type Consultation = Database["public"]["Tables"]["consultations"]["Row"];
export type Material = Database["public"]["Tables"]["materials"]["Row"];
export type Probe = Database["public"]["Tables"]["probes"]["Row"];
export type GenerationRun = Database["public"]["Tables"]["generation_runs"]["Row"];
