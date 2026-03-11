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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      cogs_modifier_option_recipe_lines: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          loss_pct: number
          qty: number
          recipe_id: string
          tenant_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          loss_pct?: number
          qty: number
          recipe_id: string
          tenant_id?: string
          unit: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          loss_pct?: number
          qty?: number
          recipe_id?: string
          tenant_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_modifier_option_recipe_lines_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_modifier_option_recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "cogs_modifier_option_recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_modifier_option_recipe_lines_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_modifier_option_recipes: {
        Row: {
          approved_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          modifier_option_id: string
          notes: string | null
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          modifier_option_id: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          modifier_option_id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cogs_modifier_option_recipes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_modifier_option_recipes_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "cogs_modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_modifier_option_recipes_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_modifier_options: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          modifier_set_id: string
          name: string
          square_modifier_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          modifier_set_id: string
          name: string
          square_modifier_id: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          modifier_set_id?: string
          name?: string
          square_modifier_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_modifier_options_modifier_set_id_fkey"
            columns: ["modifier_set_id"]
            isOneToOne: false
            referencedRelation: "cogs_modifier_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_modifier_options_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_modifier_sets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          square_modifier_list_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          square_modifier_list_id: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          square_modifier_list_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_cogs_modifier_sets_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          end_at: string
          id: string
          notes: string | null
          period_type: string
          start_at: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_at: string
          id?: string
          notes?: string | null
          period_type: string
          start_at: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_at?: string
          id?: string
          notes?: string | null
          period_type?: string
          start_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_periods_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_product_recipe_lines: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          loss_pct: number
          qty: number
          recipe_id: string
          tenant_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          loss_pct?: number
          qty: number
          recipe_id: string
          tenant_id?: string
          unit: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          loss_pct?: number
          qty?: number
          recipe_id?: string
          tenant_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_product_recipe_lines_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_product_recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "cogs_product_recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_product_recipe_lines_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_product_recipes: {
        Row: {
          approved_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          product_id: string
          tenant_id: string
          updated_at: string
          version: number
          yield_qty: number
          yield_unit: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          product_id: string
          tenant_id?: string
          updated_at?: string
          version?: number
          yield_qty?: number
          yield_unit?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          tenant_id?: string
          updated_at?: string
          version?: number
          yield_qty?: number
          yield_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_product_recipes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_product_recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "cogs_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_product_recipes_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_products: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          product_code: string | null
          square_item_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          product_code?: string | null
          square_item_id: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          product_code?: string | null
          square_item_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_cogs_products_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_reports: {
        Row: {
          begin_inventory_value: number
          created_at: string
          currency: string
          end_inventory_value: number
          id: string
          inputs: Json | null
          period_id: string
          periodic_cogs_value: number
          purchases_value: number
          tenant_id: string
        }
        Insert: {
          begin_inventory_value?: number
          created_at?: string
          currency?: string
          end_inventory_value?: number
          id?: string
          inputs?: Json | null
          period_id: string
          periodic_cogs_value?: number
          purchases_value?: number
          tenant_id?: string
        }
        Update: {
          begin_inventory_value?: number
          created_at?: string
          currency?: string
          end_inventory_value?: number
          id?: string
          inputs?: Json | null
          period_id?: string
          periodic_cogs_value?: number
          purchases_value?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_reports_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: true
            referencedRelation: "cogs_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_reports_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_sellable_aliases: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          sellable_id: string
          square_variation_id: string
          tenant_id: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          sellable_id: string
          square_variation_id: string
          tenant_id?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          sellable_id?: string
          square_variation_id?: string
          tenant_id?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cogs_sellable_aliases_sellable_id_fkey"
            columns: ["sellable_id"]
            isOneToOne: false
            referencedRelation: "cogs_sellables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_sellable_aliases_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_sellable_recipe_override_ops: {
        Row: {
          created_at: string
          id: string
          loss_pct: number | null
          multiplier: number | null
          new_inventory_item_id: string | null
          op_type: string
          override_id: string
          qty: number | null
          target_inventory_item_id: string | null
          tenant_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          loss_pct?: number | null
          multiplier?: number | null
          new_inventory_item_id?: string | null
          op_type: string
          override_id: string
          qty?: number | null
          target_inventory_item_id?: string | null
          tenant_id?: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          loss_pct?: number | null
          multiplier?: number | null
          new_inventory_item_id?: string | null
          op_type?: string
          override_id?: string
          qty?: number | null
          target_inventory_item_id?: string | null
          tenant_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cogs_sellable_recipe_override_ops_new_inventory_item_id_fkey"
            columns: ["new_inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_sellable_recipe_override_ops_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "cogs_sellable_recipe_overrides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_sellable_recipe_override_ops_target_inventory_item_id_fkey"
            columns: ["target_inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_sellable_recipe_override_ops_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_sellable_recipe_overrides: {
        Row: {
          approved_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          sellable_id: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          sellable_id: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          sellable_id?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cogs_sellable_recipe_overrides_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_sellable_recipe_overrides_sellable_id_fkey"
            columns: ["sellable_id"]
            isOneToOne: false
            referencedRelation: "cogs_sellables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_sellable_recipe_overrides_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_sellables: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          product_id: string
          square_variation_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          product_id: string
          square_variation_id: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          product_id?: string
          square_variation_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_sellables_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "cogs_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cogs_sellables_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_audit_log: {
        Row: {
          action: string
          created_at: string | null
          credential_type: string
          id: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          credential_type: string
          id?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          credential_type?: string
          id?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_cost_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          inventory_item_id: string
          new_unit_cost: number
          notes: string | null
          pack_size: number | null
          previous_unit_cost: number | null
          source: string
          source_ref: string | null
          tenant_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          inventory_item_id: string
          new_unit_cost: number
          notes?: string | null
          pack_size?: number | null
          previous_unit_cost?: number | null
          source: string
          source_ref?: string | null
          tenant_id?: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          inventory_item_id?: string
          new_unit_cost?: number
          notes?: string | null
          pack_size?: number | null
          previous_unit_cost?: number | null
          source?: string
          source_ref?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_item_cost_history_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_cost_history_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          auto_decrement: boolean | null
          created_at: string
          current_stock: number
          deleted_at: string | null
          id: string
          is_ingredient: boolean | null
          item_name: string
          item_type: string | null
          last_restocked_at: string | null
          location: string | null
          minimum_threshold: number
          notes: string | null
          pack_size: number
          reorder_point: number
          square_item_id: string
          supplier_id: string | null
          tenant_id: string
          unit_cost: number | null
          unit_type: string
          updated_at: string
        }
        Insert: {
          auto_decrement?: boolean | null
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          is_ingredient?: boolean | null
          item_name: string
          item_type?: string | null
          last_restocked_at?: string | null
          location?: string | null
          minimum_threshold?: number
          notes?: string | null
          pack_size?: number
          reorder_point?: number
          square_item_id: string
          supplier_id?: string | null
          tenant_id?: string
          unit_cost?: number | null
          unit_type?: string
          updated_at?: string
        }
        Update: {
          auto_decrement?: boolean | null
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          is_ingredient?: boolean | null
          item_name?: string
          item_type?: string | null
          last_restocked_at?: string | null
          location?: string | null
          minimum_threshold?: number
          notes?: string | null
          pack_size?: number
          reorder_point?: number
          square_item_id?: string
          supplier_id?: string | null
          tenant_id?: string
          unit_cost?: number | null
          unit_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_items_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_locations_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sales_sync_runs: {
        Row: {
          auto_decrements: number
          created_by: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          last_synced_at: string | null
          manual_pending: number
          orders_processed: number
          square_cursor: string | null
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          auto_decrements?: number
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          last_synced_at?: string | null
          manual_pending?: number
          orders_processed?: number
          square_cursor?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Update: {
          auto_decrements?: number
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          last_synced_at?: string | null
          manual_pending?: number
          orders_processed?: number
          square_cursor?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_sales_sync_runs_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sales_sync_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_settings: {
        Row: {
          alert_email: string | null
          alert_email_notifications: boolean | null
          auto_create_alerts: boolean | null
          auto_update_costs: boolean | null
          created_at: string
          currency: string
          default_location: string
          default_reorder_point_multiplier: number
          default_unit_type: string
          enable_barcode_scanning: boolean | null
          enable_expiry_tracking: boolean | null
          global_critical_stock_threshold: number
          global_low_stock_threshold: number
          id: string
          require_purchase_orders: boolean | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          alert_email?: string | null
          alert_email_notifications?: boolean | null
          auto_create_alerts?: boolean | null
          auto_update_costs?: boolean | null
          created_at?: string
          currency?: string
          default_location?: string
          default_reorder_point_multiplier?: number
          default_unit_type?: string
          enable_barcode_scanning?: boolean | null
          enable_expiry_tracking?: boolean | null
          global_critical_stock_threshold?: number
          global_low_stock_threshold?: number
          id?: string
          require_purchase_orders?: boolean | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          alert_email?: string | null
          alert_email_notifications?: boolean | null
          auto_create_alerts?: boolean | null
          auto_update_costs?: boolean | null
          created_at?: string
          currency?: string
          default_location?: string
          default_reorder_point_multiplier?: number
          default_unit_type?: string
          enable_barcode_scanning?: boolean | null
          enable_expiry_tracking?: boolean | null
          global_critical_stock_threshold?: number
          global_low_stock_threshold?: number
          id?: string
          require_purchase_orders?: boolean | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_settings_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_unit_types: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean | null
          name: string
          symbol: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          name: string
          symbol: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          name?: string
          symbol?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_unit_types_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_valuations: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          inventory_item_id: string
          method: string
          period_id: string
          qty_on_hand: number
          tenant_id: string
          unit_cost: number
          value: number
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          inventory_item_id: string
          method?: string
          period_id: string
          qty_on_hand?: number
          tenant_id?: string
          unit_cost?: number
          value?: number
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          method?: string
          period_id?: string
          qty_on_hand?: number
          tenant_id?: string
          unit_cost?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_valuations_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_valuations_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_valuations_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "cogs_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_import_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          invoice_id: string | null
          ip_address: unknown
          last_activity_at: string | null
          review_data: Json
          started_at: string | null
          status: string
          step_progress: number | null
          tenant_id: string
          total_steps: number | null
          updated_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          ip_address?: unknown
          last_activity_at?: string | null
          review_data?: Json
          started_at?: string | null
          status?: string
          step_progress?: number | null
          tenant_id?: string
          total_steps?: number | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          ip_address?: unknown
          last_activity_at?: string | null
          review_data?: Json
          started_at?: string | null
          status?: string
          step_progress?: number | null
          tenant_id?: string
          total_steps?: number | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_invoice_import_sessions_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_sessions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string | null
          id: string
          invoice_id: string | null
          is_reviewed: boolean | null
          item_description: string
          line_number: number
          match_confidence: number | null
          match_method: string | null
          matched_item_id: string | null
          package_size: string | null
          quantity: number
          review_notes: string | null
          supplier_item_code: string | null
          tenant_id: string
          total_price: number
          unit_price: number
          unit_type: string | null
          units_per_package: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          is_reviewed?: boolean | null
          item_description: string
          line_number: number
          match_confidence?: number | null
          match_method?: string | null
          matched_item_id?: string | null
          package_size?: string | null
          quantity: number
          review_notes?: string | null
          supplier_item_code?: string | null
          tenant_id?: string
          total_price: number
          unit_price: number
          unit_type?: string | null
          units_per_package?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          is_reviewed?: boolean | null
          item_description?: string
          line_number?: number
          match_confidence?: number | null
          match_method?: string | null
          matched_item_id?: string | null
          package_size?: string | null
          quantity?: number
          review_notes?: string | null
          supplier_item_code?: string | null
          tenant_id?: string
          total_price?: number
          unit_price?: number
          unit_type?: string | null
          units_per_package?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_invoice_items_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_matched_item_id_fkey"
            columns: ["matched_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          clean_text: string | null
          confirmed_at: string | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          file_url: string | null
          id: string
          invoice_date: string
          invoice_number: string
          parsed_data: Json | null
          parsing_confidence: number | null
          parsing_error: string | null
          processed_at: string | null
          processed_by: string | null
          raw_text: string | null
          status: string
          supplier_id: string | null
          tenant_id: string
          text_analysis: Json
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          clean_text?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          invoice_date: string
          invoice_number: string
          parsed_data?: Json | null
          parsing_confidence?: number | null
          parsing_error?: string | null
          processed_at?: string | null
          processed_by?: string | null
          raw_text?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id?: string
          text_analysis?: Json
          total_amount?: number
          updated_at?: string | null
        }
        Update: {
          clean_text?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          parsed_data?: Json | null
          parsing_confidence?: number | null
          parsing_error?: string | null
          processed_at?: string | null
          processed_by?: string | null
          raw_text?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id?: string
          text_analysis?: Json
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_invoices_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_categories: {
        Row: {
          color: string | null
          created_at: string
          display_type: string | null
          header_text: string | null
          icon: string | null
          id: string
          name: string
          position: string | null
          screen: string
          show_size_header: boolean | null
          size_labels: string | null
          slug: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          display_type?: string | null
          header_text?: string | null
          icon?: string | null
          id?: string
          name: string
          position?: string | null
          screen: string
          show_size_header?: boolean | null
          size_labels?: string | null
          slug: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          display_type?: string | null
          header_text?: string | null
          icon?: string | null
          id?: string
          name?: string
          position?: string | null
          screen?: string
          show_size_header?: boolean | null
          size_labels?: string | null
          slug?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_kds_categories_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_images: {
        Row: {
          alt_text: string | null
          created_at: string
          filename: string
          id: string
          is_active: boolean
          screen: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          filename: string
          id?: string
          is_active?: boolean
          screen: string
          sort_order?: number
          tenant_id?: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          filename?: string
          id?: string
          is_active?: boolean
          screen?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_kds_images_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_menu_items: {
        Row: {
          bullet_color: string | null
          category_id: string | null
          created_at: string
          display_name: string | null
          display_price: string | null
          display_type: string | null
          featured: boolean | null
          id: string
          is_visible: boolean
          name: string
          parent_item: string | null
          price_cents: number
          sort_order: number
          square_item_id: string | null
          square_variation_id: string | null
          tenant_id: string
          updated_at: string
          variation_name: string | null
        }
        Insert: {
          bullet_color?: string | null
          category_id?: string | null
          created_at?: string
          display_name?: string | null
          display_price?: string | null
          display_type?: string | null
          featured?: boolean | null
          id?: string
          is_visible?: boolean
          name: string
          parent_item?: string | null
          price_cents: number
          sort_order?: number
          square_item_id?: string | null
          square_variation_id?: string | null
          tenant_id?: string
          updated_at?: string
          variation_name?: string | null
        }
        Update: {
          bullet_color?: string | null
          category_id?: string | null
          created_at?: string
          display_name?: string | null
          display_price?: string | null
          display_type?: string | null
          featured?: boolean | null
          id?: string
          is_visible?: boolean
          name?: string
          parent_item?: string | null
          price_cents?: number
          sort_order?: number
          square_item_id?: string | null
          square_variation_id?: string | null
          tenant_id?: string
          updated_at?: string
          variation_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_kds_menu_items_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kds_menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "kds_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_settings: {
        Row: {
          id: string
          key: string
          tenant_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          tenant_id?: string
          updated_at?: string
          value: Json
        }
        Update: {
          id?: string
          key?: string
          tenant_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "fk_kds_settings_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      low_stock_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_level: string
          created_at: string
          id: string
          inventory_item_id: string
          is_acknowledged: boolean | null
          stock_level: number
          tenant_id: string
          threshold_level: number
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_level: string
          created_at?: string
          id?: string
          inventory_item_id: string
          is_acknowledged?: boolean | null
          stock_level: number
          tenant_id?: string
          threshold_level: number
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_level?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          is_acknowledged?: boolean | null
          stock_level?: number
          tenant_id?: string
          threshold_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_low_stock_alerts_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "low_stock_alerts_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          data: Json | null
          id: string
          message: string
          read: boolean
          tenant_id: string
          title: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          message: string
          read?: boolean
          tenant_id?: string
          title: string
          type?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          message?: string
          read?: boolean
          tenant_id?: string
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_notifications_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_invoice_matches: {
        Row: {
          amount_variance: number | null
          created_at: string | null
          id: string
          invoice_id: string | null
          match_confidence: number
          match_method: string
          purchase_order_id: string | null
          quantity_variance: number | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tenant_id: string
          updated_at: string | null
          variance_notes: string | null
        }
        Insert: {
          amount_variance?: number | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          match_confidence?: number
          match_method?: string
          purchase_order_id?: string | null
          quantity_variance?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
          variance_notes?: string | null
        }
        Update: {
          amount_variance?: number | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          match_confidence?: number
          match_method?: string
          purchase_order_id?: string | null
          quantity_variance?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
          variance_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_invoice_matches_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_invoice_matches_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_invoice_matches_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          item_name: string
          modifiers: Json | null
          order_id: string
          quantity: number
          square_item_id: string
          tenant_id: string
          total_price: number
          unit_price: number
          variations: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          modifiers?: Json | null
          order_id: string
          quantity?: number
          square_item_id: string
          tenant_id?: string
          total_price: number
          unit_price: number
          variations?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          modifiers?: Json | null
          order_id?: string
          quantity?: number
          square_item_id?: string
          tenant_id?: string
          total_price?: number
          unit_price?: number
          variations?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_items_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          customer_email: string | null
          customer_phone: string | null
          id: string
          payment_status: string
          pickup_time: string | null
          special_instructions: string | null
          square_order_id: string | null
          status: string
          tax_amount: number | null
          tenant_id: string
          total_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          id?: string
          payment_status?: string
          pickup_time?: string | null
          special_instructions?: string | null
          square_order_id?: string | null
          status?: string
          tax_amount?: number | null
          tenant_id?: string
          total_amount: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          id?: string
          payment_status?: string
          pickup_time?: string | null
          special_instructions?: string | null
          square_order_id?: string | null
          status?: string
          tax_amount?: number | null
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_orders_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_attachments: {
        Row: {
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          notes: string | null
          purchase_order_id: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          notes?: string | null
          purchase_order_id: string
          storage_path: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          notes?: string | null
          purchase_order_id?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_purchase_order_attachments_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string
          excluded_at: string | null
          excluded_by: string | null
          exclusion_phase: string | null
          exclusion_reason: string | null
          id: string
          inventory_item_id: string
          is_excluded: boolean
          ordered_pack_qty: number | null
          pack_size: number | null
          purchase_order_id: string
          quantity_ordered: number
          quantity_received: number | null
          tenant_id: string
          total_cost: number | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          excluded_at?: string | null
          excluded_by?: string | null
          exclusion_phase?: string | null
          exclusion_reason?: string | null
          id?: string
          inventory_item_id: string
          is_excluded?: boolean
          ordered_pack_qty?: number | null
          pack_size?: number | null
          purchase_order_id: string
          quantity_ordered: number
          quantity_received?: number | null
          tenant_id?: string
          total_cost?: number | null
          unit_cost: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          excluded_at?: string | null
          excluded_by?: string | null
          exclusion_phase?: string | null
          exclusion_reason?: string | null
          id?: string
          inventory_item_id?: string
          is_excluded?: boolean
          ordered_pack_qty?: number | null
          pack_size?: number | null
          purchase_order_id?: string
          quantity_ordered?: number
          quantity_received?: number | null
          tenant_id?: string
          total_cost?: number | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_purchase_order_items_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_receipts: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          photo_path: string | null
          photo_url: string | null
          purchase_order_id: string
          purchase_order_item_id: string
          quantity_received: number
          received_at: string
          received_by: string | null
          tenant_id: string
          weight: number | null
          weight_unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          photo_path?: string | null
          photo_url?: string | null
          purchase_order_id: string
          purchase_order_item_id: string
          quantity_received: number
          received_at?: string
          received_by?: string | null
          tenant_id?: string
          weight?: number | null
          weight_unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          photo_path?: string | null
          photo_url?: string | null
          purchase_order_id?: string
          purchase_order_item_id?: string
          quantity_received?: number
          received_at?: string
          received_by?: string | null
          tenant_id?: string
          weight?: number | null
          weight_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_purchase_order_receipts_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_purchase_order_item_id_fkey"
            columns: ["purchase_order_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_status: string
          note: string | null
          previous_status: string | null
          purchase_order_id: string
          tenant_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_status: string
          note?: string | null
          previous_status?: string | null
          purchase_order_id: string
          tenant_id?: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_status?: string
          note?: string | null
          previous_status?: string | null
          purchase_order_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_purchase_order_status_history_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_status_history_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          actual_delivery_date: string | null
          approved_at: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          expected_delivery_date: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string | null
          received_at: string | null
          sent_at: string | null
          sent_by: string | null
          sent_notes: string | null
          sent_via: string | null
          status: string
          supplier_id: string
          tenant_id: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          actual_delivery_date?: string | null
          approved_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string | null
          received_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_notes?: string | null
          sent_via?: string | null
          status?: string
          supplier_id: string
          tenant_id?: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          actual_delivery_date?: string | null
          approved_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string | null
          received_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_notes?: string | null
          sent_via?: string | null
          status?: string
          supplier_id?: string
          tenant_id?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_purchase_orders_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          created_at: string
          finished_item_id: string
          id: string
          ingredient_item_id: string
          quantity_used: number
          tenant_id: string
          unit_type: string
        }
        Insert: {
          created_at?: string
          finished_item_id: string
          id?: string
          ingredient_item_id: string
          quantity_used: number
          tenant_id?: string
          unit_type?: string
        }
        Update: {
          created_at?: string
          finished_item_id?: string
          id?: string
          ingredient_item_id?: string
          quantity_used?: number
          tenant_id?: string
          unit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_recipe_ingredients_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_finished_item_id_fkey"
            columns: ["finished_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_ingredient_item_id_fkey"
            columns: ["ingredient_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_transaction_items: {
        Row: {
          created_at: string
          id: string
          impact_reason: string | null
          impact_type: string
          inventory_item_id: string | null
          metadata: Json | null
          name: string
          quantity: number
          square_catalog_object_id: string
          tenant_id: string
          transaction_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          impact_reason?: string | null
          impact_type: string
          inventory_item_id?: string | null
          metadata?: Json | null
          name: string
          quantity: number
          square_catalog_object_id: string
          tenant_id?: string
          transaction_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          impact_reason?: string | null
          impact_type?: string
          inventory_item_id?: string | null
          metadata?: Json | null
          name?: string
          quantity?: number
          square_catalog_object_id?: string
          tenant_id?: string
          transaction_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_transaction_items_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_transaction_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_transaction_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "sales_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_transactions: {
        Row: {
          customer_name: string | null
          id: string
          location_id: string
          order_number: string | null
          ordered_at: string
          raw_payload: Json
          square_order_id: string
          sync_run_id: string | null
          synced_at: string
          tenant_id: string
          tender_currency: string | null
          tender_total_money: number | null
          tender_type: string | null
        }
        Insert: {
          customer_name?: string | null
          id?: string
          location_id: string
          order_number?: string | null
          ordered_at: string
          raw_payload: Json
          square_order_id: string
          sync_run_id?: string | null
          synced_at?: string
          tenant_id?: string
          tender_currency?: string | null
          tender_total_money?: number | null
          tender_type?: string | null
        }
        Update: {
          customer_name?: string | null
          id?: string
          location_id?: string
          order_number?: string | null
          ordered_at?: string
          raw_payload?: Json
          square_order_id?: string
          sync_run_id?: string | null
          synced_at?: string
          tenant_id?: string
          tender_currency?: string | null
          tender_total_money?: number | null
          tender_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_transactions_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_transactions_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "inventory_sales_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          created_at: string
          id: string
          is_customer_app_live: boolean
          maintenance_cta_href: string | null
          maintenance_cta_label: string | null
          maintenance_message: string | null
          maintenance_title: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_customer_app_live?: boolean
          maintenance_cta_href?: string | null
          maintenance_cta_label?: string | null
          maintenance_message?: string | null
          maintenance_title?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_customer_app_live?: boolean
          maintenance_cta_href?: string | null
          maintenance_cta_label?: string | null
          maintenance_message?: string | null
          maintenance_title?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_site_settings_tenant"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inventory_item_id: string
          movement_type: string
          new_stock: number
          notes: string | null
          previous_stock: number
          quantity_change: number
          reference_id: string | null
          tenant_id: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_item_id: string
          movement_type: string
          new_stock: number
          notes?: string | null
          previous_stock: number
          quantity_change: number
          reference_id?: string | null
          tenant_id?: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_item_id?: string
          movement_type?: string
          new_stock?: number
          notes?: string | null
          previous_stock?: number
          quantity_change?: number
          reference_id?: string | null
          tenant_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_stock_movements_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_email_templates: {
        Row: {
          body_template: string
          created_at: string
          created_by: string | null
          id: string
          subject_template: string
          supplier_id: string
          template_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body_template: string
          created_at?: string
          created_by?: string | null
          id?: string
          subject_template: string
          supplier_id: string
          template_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          created_at?: string
          created_by?: string | null
          id?: string
          subject_template?: string
          supplier_id?: string
          template_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_supplier_email_templates_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_email_templates_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoice_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          default_unit_conversions: Json
          format_config: Json
          id: string
          is_active: boolean | null
          item_matching_rules: Json
          last_used_at: string | null
          package_mappings: Json
          parsing_rules: Json
          success_rate: number | null
          supplier_id: string | null
          template_name: string
          template_version: string | null
          tenant_id: string
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          default_unit_conversions?: Json
          format_config?: Json
          id?: string
          is_active?: boolean | null
          item_matching_rules?: Json
          last_used_at?: string | null
          package_mappings?: Json
          parsing_rules?: Json
          success_rate?: number | null
          supplier_id?: string | null
          template_name: string
          template_version?: string | null
          tenant_id?: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          default_unit_conversions?: Json
          format_config?: Json
          id?: string
          is_active?: boolean | null
          item_matching_rules?: Json
          last_used_at?: string | null
          package_mappings?: Json
          parsing_rules?: Json
          success_rate?: number | null
          supplier_id?: string | null
          template_name?: string
          template_version?: string | null
          tenant_id?: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_supplier_invoice_templates_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_templates_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_suppliers_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          role?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_pending_invites: {
        Row: {
          deleted_at: string | null
          id: string
          invited_at: string
          invited_email: string
          role: string
          tenant_id: string
        }
        Insert: {
          deleted_at?: string | null
          id?: string
          invited_at?: string
          invited_email: string
          role?: string
          tenant_id: string
        }
        Update: {
          deleted_at?: string | null
          id?: string
          invited_at?: string
          invited_email?: string
          role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_pending_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          business_address: string | null
          business_email: string | null
          business_hours: Json | null
          business_name: string
          business_phone: string | null
          created_at: string | null
          deleted_at: string | null
          email_sender_address: string | null
          email_sender_name: string | null
          features: Json | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          primary_color: string | null
          secondary_color: string | null
          slug: string
          square_access_token: string | null
          square_access_token_vault_id: string | null
          square_application_id: string | null
          square_environment: string | null
          square_location_id: string | null
          square_merchant_id: string | null
          square_token_expires_at: string | null
          square_webhook_key_vault_id: string | null
          square_webhook_signature_key: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          status_changed_at: string
          trial_days: number | null
          trial_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          business_address?: string | null
          business_email?: string | null
          business_hours?: Json | null
          business_name: string
          business_phone?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email_sender_address?: string | null
          email_sender_name?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          square_access_token?: string | null
          square_access_token_vault_id?: string | null
          square_application_id?: string | null
          square_environment?: string | null
          square_location_id?: string | null
          square_merchant_id?: string | null
          square_token_expires_at?: string | null
          square_webhook_key_vault_id?: string | null
          square_webhook_signature_key?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          status_changed_at?: string
          trial_days?: number | null
          trial_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          business_address?: string | null
          business_email?: string | null
          business_hours?: Json | null
          business_name?: string
          business_phone?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email_sender_address?: string | null
          email_sender_name?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          square_access_token?: string | null
          square_access_token_vault_id?: string | null
          square_application_id?: string | null
          square_environment?: string | null
          square_location_id?: string | null
          square_merchant_id?: string | null
          square_token_expires_at?: string | null
          square_webhook_key_vault_id?: string | null
          square_webhook_signature_key?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          status_changed_at?: string
          trial_days?: number | null
          trial_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_addresses: {
        Row: {
          city: string
          created_at: string
          id: string
          is_default: boolean | null
          label: string
          state: string
          street_address: string
          tenant_id: string
          updated_at: string
          user_id: string
          zip_code: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          is_default?: boolean | null
          label?: string
          state: string
          street_address: string
          tenant_id?: string
          updated_at?: string
          user_id: string
          zip_code: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          is_default?: boolean | null
          label?: string
          state?: string
          street_address?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_user_addresses_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_favorites: {
        Row: {
          created_at: string
          id: string
          item_name: string
          square_item_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          square_item_id: string
          tenant_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          square_item_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_user_favorites_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          event_data: Json
          event_id: string
          event_type: string
          id: string
          merchant_id: string | null
          processed_at: string
          sync_result: Json | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          event_data: Json
          event_id: string
          event_type: string
          id?: string
          merchant_id?: string | null
          processed_at?: string
          sync_result?: Json | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          event_data?: Json
          event_id?: string
          event_type?: string
          id?: string
          merchant_id?: string | null
          processed_at?: string
          sync_result?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_webhook_events_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      po_supplier_metrics_v: {
        Row: {
          avg_approval_days: number | null
          avg_invoice_throughput_days: number | null
          avg_issue_days: number | null
          avg_receipt_days: number | null
          invoice_exception_count: number | null
          invoice_match_count: number | null
          on_time_receipts: number | null
          open_balance: number | null
          period_month: string | null
          quantity_ordered: number | null
          quantity_received: number | null
          supplier_id: string | null
          supplier_name: string | null
          total_pos: number | null
          total_receipts: number | null
          total_spend: number | null
          variance_match_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      view_pending_manual_inventory_deductions: {
        Row: {
          inventory_item_id: string | null
          item_name: string | null
          last_sync_run_id: string | null
          last_transaction_at: string | null
          total_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_transaction_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      bootstrap_platform_admin: {
        Args: { admin_email: string }
        Returns: string
      }
      calculate_invoice_total: {
        Args: { invoice_uuid: string }
        Returns: number
      }
      create_order_notification: {
        Args: {
          p_order_id: string
          p_order_number: string
          p_status: string
          p_user_id: string
        }
        Returns: string
      }
      db_pre_request: { Args: never; Returns: undefined }
      decrement_inventory_stock: {
        Args: { item_id: string; quantity: number }
        Returns: undefined
      }
      get_admin_user_id: { Args: never; Returns: string }
      get_square_credentials_for_oauth: {
        Args: { p_tenant_id: string }
        Returns: {
          access_token: string
          environment: string
          merchant_id: string
          refresh_token: string
        }[]
      }
      get_tenant_square_credentials: {
        Args: { p_tenant_id: string }
        Returns: {
          access_token: string
          application_id: string
          environment: string
          location_id: string
          merchant_id: string
          webhook_signature_key: string
        }[]
      }
      get_tenant_square_credentials_internal: {
        Args: { p_tenant_id: string }
        Returns: {
          access_token: string
          application_id: string
          environment: string
          location_id: string
          merchant_id: string
          webhook_signature_key: string
        }[]
      }
      get_unread_notification_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      increment_inventory_stock: {
        Args: { item_id: string; quantity: number }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_tenant_member: { Args: { p_roles?: string[] }; Returns: boolean }
      log_purchase_order_receipt: {
        Args: {
          p_notes?: string
          p_photo_path?: string
          p_photo_url?: string
          p_purchase_order_id: string
          p_purchase_order_item_id: string
          p_quantity: number
          p_received_by: string
          p_weight?: number
          p_weight_unit?: string
        }
        Returns: Json
      }
      mark_all_notifications_read: {
        Args: { p_user_id: string }
        Returns: number
      }
      notify_trial_expiring: { Args: never; Returns: undefined }
      restore_tenant: { Args: { tenant_id: string }; Returns: undefined }
      rpc_po_supplier_metrics: {
        Args: {
          p_end_date?: string
          p_start_date?: string
          p_supplier_ids?: string[]
        }
        Returns: {
          avg_approval_days: number
          avg_invoice_throughput_days: number
          avg_issue_days: number
          avg_receipt_days: number
          fulfillment_ratio: number
          invoice_exception_count: number
          invoice_exception_rate: number
          invoice_match_count: number
          on_time_ratio: number
          open_balance: number
          period_month: string
          supplier_id: string
          supplier_name: string
          total_pos: number
          total_spend: number
          variance_match_count: number
          variance_rate: number
        }[]
      }
      set_tenant_context: { Args: { p_tenant_id: string }; Returns: undefined }
      set_tenant_from_request: { Args: never; Returns: undefined }
      set_tenant_square_credentials: {
        Args: {
          p_access_token?: string
          p_tenant_id: string
          p_webhook_signature_key?: string
        }
        Returns: undefined
      }
      shift_inventory_between_items: {
        Args: {
          p_from_item_id: string
          p_quantity: number
          p_to_item_id: string
        }
        Returns: undefined
      }
      store_square_credentials: {
        Args: {
          p_access_token: string
          p_environment: string
          p_expires_at: string
          p_merchant_id: string
          p_refresh_token: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      store_square_credentials_internal: {
        Args: {
          p_access_token: string
          p_environment: string
          p_expires_at: string
          p_merchant_id: string
          p_refresh_token: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      update_inventory_stock: {
        Args: {
          item_id: string
          notes?: string
          operation_type?: string
          quantity_change: number
        }
        Returns: undefined
      }
      update_stock_simple: {
        Args: { item_id: string; new_stock: number }
        Returns: undefined
      }
    }
    Enums: {
      tenant_status: "trial" | "active" | "paused" | "suspended" | "deleted"
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
    Enums: {
      tenant_status: ["trial", "active", "paused", "suspended", "deleted"],
    },
  },
} as const
