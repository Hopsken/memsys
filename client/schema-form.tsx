import { useState } from "react";
import * as z from "zod/mini";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { Json, JsonObject } from "../contract/plugin";

// The subset of JSON Schema rendered as native controls; anything else gets a JSON editor.
const fieldSchema = z.object({
  description: z.optional(z.string()),
  enum: z.optional(z.array(z.json())),
  maximum: z.optional(z.number()),
  minimum: z.optional(z.number()),
  title: z.optional(z.string()),
  type: z.optional(z.string()),
});
type FieldSchema = z.infer<typeof fieldSchema>;

const objectSchema = z.object({
  properties: z.record(z.string(), z.json()),
  type: z.literal("object"),
});

const jsonObject = z.record(z.string(), z.json());

export type FieldErrors = Record<string, string>;

// A plugin with an empty object schema has nothing to configure.
export const hasFields = (schema: JsonObject) => {
  const editable = z.safeParse(objectSchema, schema);
  return !editable.success || Object.keys(editable.data.properties).length > 0;
};

const parseJson = (text: string) => {
  try {
    return z.safeParse(z.json(), JSON.parse(text));
  } catch {
    return null;
  }
};

interface FieldProps {
  id: string;
  field: FieldSchema;
  value: Json | undefined;
  invalid: boolean;
  onChange: (value: Json | undefined) => void;
}

const JsonField = ({ id, invalid, onChange, value }: FieldProps) => {
  const [text, setText] = useState(() =>
    JSON.stringify(value ?? null, null, 2)
  );
  const [parseError, setParseError] = useState(false);
  return (
    <textarea
      aria-invalid={invalid || parseError}
      className="focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive min-h-24 w-full rounded-md border bg-white px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
      id={id}
      onChange={(event) => {
        setText(event.currentTarget.value);
        const parsed = parseJson(event.currentTarget.value);
        setParseError(!parsed?.success);
        if (parsed?.success) {
          onChange(parsed.data);
        }
      }}
      spellCheck={false}
      value={text}
    />
  );
};

const Control = (props: FieldProps) => {
  const { field, id, invalid, onChange, value } = props;
  if (field.enum) {
    const options = field.enum.map((option) => JSON.stringify(option));
    return (
      <select
        aria-invalid={invalid}
        className="focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        id={id}
        onChange={(event) => {
          const index = options.indexOf(event.currentTarget.value);
          onChange(field.enum?.[index]);
        }}
        value={JSON.stringify(value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "integer" || field.type === "number") {
    return (
      <Input
        aria-invalid={invalid}
        className="max-w-40 font-mono tabular-nums"
        id={id}
        inputMode={field.type === "integer" ? "numeric" : "decimal"}
        max={field.maximum}
        min={field.minimum}
        onChange={(event) => {
          const number = event.currentTarget.valueAsNumber;
          onChange(Number.isNaN(number) ? undefined : number);
        }}
        step={field.type === "integer" ? 1 : "any"}
        type="number"
        value={z.safeParse(z.number(), value).data ?? ""}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <Switch
        aria-invalid={invalid}
        checked={value === true}
        id={id}
        onCheckedChange={onChange}
      />
    );
  }
  if (field.type === "string") {
    return (
      <Input
        aria-invalid={invalid}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={z.safeParse(z.string(), value).data ?? ""}
      />
    );
  }
  return <JsonField {...props} />;
};

export const SchemaForm = ({
  defaults,
  disabled,
  errors,
  idPrefix,
  onChange,
  schema,
  value,
}: {
  defaults: Json;
  disabled: boolean;
  errors: FieldErrors;
  idPrefix: string;
  onChange: (value: Json) => void;
  schema: JsonObject;
  value: Json;
}) => {
  const editable = z.safeParse(objectSchema, schema);
  const current = z.safeParse(jsonObject, value).data ?? {};
  const fallback = z.safeParse(jsonObject, defaults).data ?? {};
  if (!editable.success) {
    return (
      <JsonField
        field={{}}
        id={`${idPrefix}-json`}
        invalid={Boolean(errors[""])}
        onChange={(next) => onChange(next ?? null)}
        value={value}
      />
    );
  }
  const fields = Object.entries(editable.data.properties);
  return (
    <fieldset className="space-y-5" disabled={disabled}>
      {fields.map(([key, raw]) => {
        const field = z.safeParse(fieldSchema, raw).data ?? {};
        const id = `${idPrefix}-${key}`;
        const error = errors[key];
        const modified =
          JSON.stringify(current[key]) !== JSON.stringify(fallback[key]);
        return (
          <div className="space-y-2" key={key}>
            <div className="flex items-baseline justify-between gap-3">
              <label className="text-sm font-medium" htmlFor={id}>
                {field.title ?? key}
                {modified ? (
                  <span
                    aria-label="Changed from default"
                    className="bg-primary ml-2 inline-block size-1.5 rounded-full align-middle"
                  />
                ) : null}
              </label>
              <span className="text-muted-foreground font-mono text-xs">
                default {JSON.stringify(fallback[key])}
              </span>
            </div>
            <Control
              field={field}
              id={id}
              invalid={Boolean(error)}
              onChange={(next) => {
                const { [key]: _removed, ...rest } = current;
                onChange(
                  next === undefined ? rest : { ...current, [key]: next }
                );
              }}
              value={current[key]}
            />
            <p
              className={cn(
                "text-xs",
                error ? "text-destructive" : "text-muted-foreground"
              )}
              id={`${id}-hint`}
            >
              {error ?? field.description}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
};
