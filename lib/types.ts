// Minimal hand-written types for Milestone 0 (profiles, lodges, user_lodge_access).
// Regenerate full types later with the Supabase CLI:
//   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: string;
          phone: string | null;
          status: string;
          extra: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: string;
          phone?: string | null;
          status?: string;
        };
        Update: Partial<{
          full_name: string | null;
          role: string;
          phone: string | null;
          status: string;
        }>;
        Relationships: [];
      };
      lodges: {
        Row: {
          id: string;
          name: string;
          location: string | null;
          room_count: number | null;
          capacity: number | null;
          status: string;
          config: unknown;
          extra: unknown;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          location?: string | null;
          room_count?: number | null;
          capacity?: number | null;
          status?: string;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          location: string | null;
          room_count: number | null;
          capacity: number | null;
          status: string;
        }>;
        Relationships: [];
      };
      user_lodge_access: {
        Row: {
          id: string;
          user_id: string;
          lodge_id: string;
          created_at: string;
        };
        Insert: { user_id: string; lodge_id: string };
        Update: Partial<{ user_id: string; lodge_id: string }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
