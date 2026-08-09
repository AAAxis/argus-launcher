export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      api_tokens: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string | null
          org_id: string
          prefix: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string | null
          org_id: string
          prefix: string
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string | null
          org_id?: string
          prefix?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          automation_id: string | null
          automation_name: string
          created_at: string
          duration_ms: number | null
          error: string | null
          failed_step_id: string | null
          finished_at: string | null
          id: string
          log: Json
          org_id: string
          profile_id: string | null
          profile_name: string
          started_at: string
          status: string
          step_count: number
          trigger: string
          vars: Json
        }
        Insert: {
          automation_id?: string | null
          automation_name?: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          failed_step_id?: string | null
          finished_at?: string | null
          id: string
          log?: Json
          org_id: string
          profile_id?: string | null
          profile_name?: string
          started_at?: string
          status?: string
          step_count?: number
          trigger?: string
          vars?: Json
        }
        Update: {
          automation_id?: string | null
          automation_name?: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          failed_step_id?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          org_id?: string
          profile_id?: string | null
          profile_name?: string
          started_at?: string
          status?: string
          step_count?: number
          trigger?: string
          vars?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_stars: {
        Row: {
          automation_id: string
          org_id: string
          starred_at: string
          user_id: string
        }
        Insert: {
          automation_id: string
          org_id: string
          starred_at?: string
          user_id?: string
        }
        Update: {
          automation_id?: string
          org_id?: string
          starred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_stars_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_stars_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_telegram_prefs: {
        Row: {
          automation_id: string
          notify_on: string
          org_id: string
          user_id: string
        }
        Insert: {
          automation_id: string
          notify_on: string
          org_id: string
          user_id?: string
        }
        Update: {
          automation_id?: string
          notify_on?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_telegram_prefs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_telegram_prefs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          assigned_to: string | null
          close_on_finish: boolean
          color: string | null
          created_at: string
          created_by: string | null
          created_by_label: string | null
          created_via: string
          deleted_at: string | null
          description: string | null
          folder_id: string | null
          icon: string | null
          id: string
          last_run_at: string | null
          last_run_status: string | null
          name: string
          notify_connector_id: string | null
          notify_on: string | null
          org_id: string
          parameters: Json
          pinned: boolean
          schedule: Json | null
          steps: Json
          tags: string[] | null
          timeout_ms: number
          updated_at: string
          updated_by: string | null
          variables: Json
        }
        Insert: {
          assigned_to?: string | null
          close_on_finish?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_label?: string | null
          created_via?: string
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          icon?: string | null
          id: string
          last_run_at?: string | null
          last_run_status?: string | null
          name: string
          notify_connector_id?: string | null
          notify_on?: string | null
          org_id: string
          parameters?: Json
          pinned?: boolean
          schedule?: Json | null
          steps?: Json
          tags?: string[] | null
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Update: {
          assigned_to?: string | null
          close_on_finish?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_label?: string | null
          created_via?: string
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string
          notify_connector_id?: string | null
          notify_on?: string | null
          org_id?: string
          parameters?: Json
          pinned?: boolean
          schedule?: Json | null
          steps?: Json
          tags?: string[] | null
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automations_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          category: string
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          kind: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          category: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          kind: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          kind?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connectors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cookie_sets: {
        Row: {
          assigned_to: string | null
          color: string | null
          cookies: Json
          count: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          folder_id: string | null
          id: string
          name: string | null
          org_id: string
          source_url: string | null
          status: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          color?: string | null
          cookies?: Json
          count?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          name?: string | null
          org_id: string
          source_url?: string | null
          status?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          color?: string | null
          cookies?: Json
          count?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          name?: string | null
          org_id?: string
          source_url?: string | null
          status?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cookie_sets_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cookie_sets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_statuses: {
        Row: {
          color: string | null
          id: string
          label: string | null
          org_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          label?: string | null
          org_id: string
        }
        Update: {
          color?: string | null
          id?: string
          label?: string | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_statuses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          kind: string
          name: string | null
          org_id: string
          parent_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          kind?: string
          name?: string | null
          org_id: string
          parent_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          kind?: string
          name?: string | null
          org_id?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      handoffs: {
        Row: {
          created_at: string
          from_user: string | null
          id: string
          item_id: string
          item_name: string
          kind: string
          note: string | null
          org_id: string
          resolved_at: string | null
          status: string
          to_user: string
        }
        Insert: {
          created_at?: string
          from_user?: string | null
          id?: string
          item_id: string
          item_name?: string
          kind: string
          note?: string | null
          org_id: string
          resolved_at?: string | null
          status?: string
          to_user: string
        }
        Update: {
          created_at?: string
          from_user?: string | null
          id?: string
          item_id?: string
          item_name?: string
          kind?: string
          note?: string | null
          org_id?: string
          resolved_at?: string | null
          status?: string
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: "handoffs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          notification_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          automation_id: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          org_id: string
          run_id: string | null
          status: string | null
          title: string
        }
        Insert: {
          automation_id?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          org_id: string
          run_id?: string | null
          status?: string | null
          title: string
        }
        Update: {
          automation_id?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          org_id?: string
          run_id?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          last_emailed_at: string | null
          org_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          last_emailed_at?: string | null
          org_id: string
          role?: string
          status?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          last_emailed_at?: string | null
          org_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          invited_by: string | null
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          automation_limit: number | null
          billing_status: string
          built_in_extensions: Json
          country: string | null
          created_at: string
          current_period_end: string | null
          id: string
          legacy_updated_at: string | null
          legacy_user_id: string | null
          legal_name: string | null
          logo_url: string | null
          name: string
          onboarded_at: string | null
          org_type: string | null
          plan: string
          profile_limit: number | null
          seat_limit: number
          telegram_bot_name: string | null
          telegram_bot_token: string | null
          website: string | null
        }
        Insert: {
          automation_limit?: number | null
          billing_status?: string
          built_in_extensions?: Json
          country?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          legacy_updated_at?: string | null
          legacy_user_id?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name: string
          onboarded_at?: string | null
          org_type?: string | null
          plan?: string
          profile_limit?: number | null
          seat_limit?: number
          telegram_bot_name?: string | null
          telegram_bot_token?: string | null
          website?: string | null
        }
        Update: {
          automation_limit?: number | null
          billing_status?: string
          built_in_extensions?: Json
          country?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          legacy_updated_at?: string | null
          legacy_user_id?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          onboarded_at?: string | null
          org_type?: string | null
          plan?: string
          profile_limit?: number | null
          seat_limit?: number
          telegram_bot_name?: string | null
          telegram_bot_token?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_plan_fkey"
            columns: ["plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          id: string
          org_id: string | null
          processed_at: string | null
          provider: string
          provider_event_id: string
          raw: Json
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string | null
          processed_at?: string | null
          provider: string
          provider_event_id: string
          raw: Json
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string | null
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          raw?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_terms: {
        Row: {
          discount_bps: number
          months: number
        }
        Insert: {
          discount_bps: number
          months: number
        }
        Update: {
          discount_bps?: number
          months?: number
        }
        Relationships: []
      }
      plans: {
        Row: {
          api_access: boolean
          currency: string
          extra_seat_cents: number | null
          key: string
          name: string
          price_cents: number
          profile_limit: number | null
          seat_limit: number
          sort: number | null
        }
        Insert: {
          api_access?: boolean
          currency?: string
          extra_seat_cents?: number | null
          key: string
          name: string
          price_cents: number
          profile_limit?: number | null
          seat_limit?: number
          sort?: number | null
        }
        Update: {
          api_access?: boolean
          currency?: string
          extra_seat_cents?: number | null
          key?: string
          name?: string
          price_cents?: number
          profile_limit?: number | null
          seat_limit?: number
          sort?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assigned_to: string | null
          automation_id: string | null
          automation_vars: Json
          avatar: string | null
          color: string | null
          command_line_switches: string[] | null
          cookie_import_count: number | null
          cookie_import_name: string | null
          cookie_import_path: string | null
          cookie_import_url: string | null
          cookie_mode: string | null
          cookie_set_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          fingerprint: Json
          folder_id: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          password: string | null
          proxy_id: string | null
          proxy_mode: string | null
          start_urls: string[] | null
          status: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          automation_id?: string | null
          automation_vars?: Json
          avatar?: string | null
          color?: string | null
          command_line_switches?: string[] | null
          cookie_import_count?: number | null
          cookie_import_name?: string | null
          cookie_import_path?: string | null
          cookie_import_url?: string | null
          cookie_mode?: string | null
          cookie_set_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          fingerprint?: Json
          folder_id?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          password?: string | null
          proxy_id?: string | null
          proxy_mode?: string | null
          start_urls?: string[] | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          automation_id?: string | null
          automation_vars?: Json
          avatar?: string | null
          color?: string | null
          command_line_switches?: string[] | null
          cookie_import_count?: number | null
          cookie_import_name?: string | null
          cookie_import_path?: string | null
          cookie_import_url?: string | null
          cookie_mode?: string | null
          cookie_set_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          fingerprint?: Json
          folder_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          password?: string | null
          proxy_id?: string | null
          proxy_mode?: string | null
          start_urls?: string[] | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_cookie_set_id_fkey"
            columns: ["cookie_set_id"]
            isOneToOne: false
            referencedRelation: "cookie_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_proxy_id_fkey"
            columns: ["proxy_id"]
            isOneToOne: false
            referencedRelation: "proxies"
            referencedColumns: ["id"]
          },
        ]
      }
      proxies: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          folder_id: string | null
          host: string | null
          id: string
          last_checked_at: string | null
          last_country: string | null
          last_country_code: string | null
          last_city: string | null
          last_error: string | null
          last_ip: string | null
          last_latency_ms: number | null
          last_latitude: number | null
          last_longitude: number | null
          last_region: string | null
          last_timezone: string | null
          name: string | null
          org_id: string
          password: string | null
          port: number | null
          status: string | null
          type: string | null
          username: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          host?: string | null
          id?: string
          last_checked_at?: string | null
          last_country?: string | null
          last_country_code?: string | null
          last_city?: string | null
          last_error?: string | null
          last_ip?: string | null
          last_latency_ms?: number | null
          last_latitude?: number | null
          last_longitude?: number | null
          last_region?: string | null
          last_timezone?: string | null
          name?: string | null
          org_id: string
          password?: string | null
          port?: number | null
          status?: string | null
          type?: string | null
          username?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          host?: string | null
          id?: string
          last_checked_at?: string | null
          last_country?: string | null
          last_country_code?: string | null
          last_city?: string | null
          last_error?: string | null
          last_ip?: string | null
          last_latency_ms?: number | null
          last_latitude?: number | null
          last_longitude?: number | null
          last_region?: string | null
          last_timezone?: string | null
          name?: string | null
          org_id?: string
          password?: string | null
          port?: number | null
          status?: string | null
          type?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proxies_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proxies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_bookmarks: {
        Row: {
          icon: string | null
          id: string
          org_id: string
          position: number | null
          title: string | null
          url: string | null
        }
        Insert: {
          icon?: string | null
          id?: string
          org_id: string
          position?: number | null
          title?: string | null
          url?: string | null
        }
        Update: {
          icon?: string | null
          id?: string
          org_id?: string
          position?: number | null
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_bookmarks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_extensions: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string | null
          org_id: string
          source: string | null
          storage_path: string | null
          storage_url: string | null
          webstore_id: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string | null
          org_id: string
          source?: string | null
          storage_path?: string | null
          storage_url?: string | null
          webstore_id?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string | null
          org_id?: string
          source?: string | null
          storage_path?: string | null
          storage_url?: string | null
          webstore_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_extensions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          current_period_end: string | null
          id: string
          org_id: string
          period_months: number
          plan: string
          provider: string
          provider_ref: string | null
          seats: number
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          current_period_end?: string | null
          id?: string
          org_id: string
          period_months: number
          plan: string
          provider: string
          provider_ref?: string | null
          seats?: number
          status: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          org_id?: string
          period_months?: number
          plan?: string
          provider?: string
          provider_ref?: string | null
          seats?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_fkey"
            columns: ["plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string
          email: string | null
          id: string
          message: string
          org_id: string | null
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message: string
          org_id?: string | null
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          org_id?: string | null
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_telegram: {
        Row: {
          chat_id: string
          linked_at: string
          telegram_username: string | null
          user_id: string
        }
        Insert: {
          chat_id: string
          linked_at?: string
          telegram_username?: string | null
          user_id?: string
        }
        Update: {
          chat_id?: string
          linked_at?: string
          telegram_username?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_handoff: { Args: { p_id: string }; Returns: undefined }
      accept_org_invite: { Args: { p_token: string }; Returns: string }
      apply_plan_entitlements: {
        Args: { p_org: string; p_plan: string }
        Returns: undefined
      }
      bootstrap_org: { Args: { org_name?: string }; Returns: string }
      cancel_handoff: { Args: { p_id: string }; Returns: undefined }
      create_org_invite: {
        Args: { p_email: string; p_org: string; p_role?: string }
        Returns: {
          invite_expires_at: string
          invite_id: string
          invite_token: string
        }[]
      }
      decline_handoff: { Args: { p_id: string }; Returns: undefined }
      is_org_admin: { Args: { target: string }; Returns: boolean }
      is_org_member: { Args: { target: string }; Returns: boolean }
      is_org_owner: { Args: { target: string }; Returns: boolean }
      offer_handoff: {
        Args: {
          p_ids: string[]
          p_kind: string
          p_note?: string
          p_org: string
          p_to: string
        }
        Returns: {
          handoff_id: string
          handoff_item_id: string
        }[]
      }
      org_members_with_identity: {
        Args: { p_org: string }
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          email: string
          invited_by: string
          role: string
          user_id: string
        }[]
      }
      peek_org_invite: {
        Args: { p_token: string }
        Returns: {
          invite_email: string
          invite_expires_at: string
          invite_role: string
          invite_status: string
          org_legal_name: string
          org_logo_url: string
          org_name: string
        }[]
      }
      set_assignee: {
        Args: { p_id: string; p_kind: string; p_org: string; p_to: string }
        Returns: undefined
      }
      set_assignees: {
        Args: { p_ids: string[]; p_kind: string; p_org: string; p_to: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
