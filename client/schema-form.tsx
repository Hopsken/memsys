import { cn } from "cn";
import { useState } from "react";
import * as z from "zod/mini";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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

// Types whose control fits beside the label; anything else spans the row.
const INLINE_TYPES = new Set(["boolean", "integer", "number", "string"]);

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
    <Textarea
      aria-invalid={invalid || parseError}
      className="min-h-24 font-mono text-xs"
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
      <Select
        items={options.map((option) => ({ label: option, value: option }))}
        onValueChange={(next) => {
          onChange(field.enum?.[options.indexOf(next ?? "")]);
        }}
        value={value === undefined ? null : JSON.stringify(value)}
      >
        <SelectTrigger aria-invalid={invalid} className="w-40" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === "integer" || field.type === "number") {
    return (
      <Input
        aria-invalid={invalid}
        className="w-24 text-right font-mono tabular-nums"
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
        className="w-40 sm:w-56"
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
    <fieldset className="divide-y" disabled={disabled}>
      {fields.map(([key, raw]) => {
        const field = z.safeParse(fieldSchema, raw).data ?? {};
        const id = `${idPrefix}-${key}`;
        const error = errors[key];
        const modified =
          JSON.stringify(current[key]) !== JSON.stringify(fallback[key]);
        const wide = !field.enum && !INLINE_TYPES.has(field.type ?? "");
        return (
          <div
            className={cn(
              "grid gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0",
              wide ? "" : "grid-cols-[minmax(0,1fr)_auto] items-center"
            )}
            key={key}
          >
            <div className="min-w-0">
              <Label htmlFor={id}>{field.title ?? key}</Label>
              <p
                className={cn(
                  "mt-0.5 text-xs",
                  error ? "text-destructive" : "text-muted-foreground"
                )}
                id={`${id}-hint`}
              >
                {error ?? field.description}
                {modified && !error ? (
                  <span className="text-primary font-medium whitespace-nowrap">
                    {" "}
                    · default {JSON.stringify(fallback[key])}
                  </span>
                ) : null}
              </p>
            </div>
            <div className={wide ? "" : "flex justify-end"}>
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
            </div>
          </div>
        );
      })}
    </fieldset>
  );
};
