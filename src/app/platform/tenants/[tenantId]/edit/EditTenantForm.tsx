'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/components/ui/Button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import Input from '@/components/ui/Input';
import { updateTenant } from '../../actions';

const formSchema = z.object({
  name: z.string().min(1).max(200),
  business_name: z.string().min(1).max(200),
  logo_url: z.string().url().nullable().or(z.literal('')),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().or(z.literal('')),
  secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().or(z.literal('')),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface EditTenantFormProps {
  tenant: {
    id: string;
    name: string;
    business_name: string | null;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    is_active: boolean;
  };
}

export default function EditTenantForm({ tenant }: EditTenantFormProps) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    updateTenant.bind(null, tenant.id),
    { errors: {} }
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: tenant.name,
      business_name: tenant.business_name || tenant.name,
      logo_url: tenant.logo_url || '',
      primary_color: tenant.primary_color || '',
      secondary_color: tenant.secondary_color || '',
      is_active: tenant.is_active,
    },
  });

  const onSubmit = async (data: FormValues) => {
    const formDataObj = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      formDataObj.append(key, String(value));
    });

    const result = await formAction(formDataObj);
    if (result.success) {
      router.push(`/platform/tenants/${tenant.id}`);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Edit Tenant</h1>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="business_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="logo_url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Logo URL</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="primary_color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Primary Color</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} placeholder="#f59e0b" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="secondary_color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Secondary Color</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} placeholder="#0f172a" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="is_active"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Active
                </FormLabel>
                <FormMessage />
              </FormItem>
            )}
          />

          {state.errors?._form && (
            <p className="text-red-500">{state.errors._form[0]}</p>
          )}

          <div className="flex gap-2">
            <Button type="submit">Save Changes</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/platform/tenants/${tenant.id}`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
