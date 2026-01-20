DO $$
DECLARE
  col_type text;
BEGIN
  IF to_regclass('public.carts') IS NULL THEN
    RETURN;
  END IF;

  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'carts' AND column_name = 'cost_price';

  IF col_type = 'jsonb' THEN
    EXECUTE 'ALTER TABLE "carts" ALTER COLUMN "cost_price" TYPE numeric(10, 2) USING CASE WHEN "cost_price" ? ''total'' THEN (("cost_price"->>''total'')::numeric / 100) ELSE NULL END';
  ELSIF col_type IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "carts" ALTER COLUMN "cost_price" TYPE numeric(10, 2) USING (CASE WHEN NULLIF(regexp_replace("cost_price"::text, ''[^0-9\\.-]'', '''', ''g''), '''') IS NULL THEN NULL ELSE CASE WHEN abs((NULLIF(regexp_replace("cost_price"::text, ''[^0-9\\.-]'', '''', ''g''), '''')::numeric)) < 100000000 THEN (NULLIF(regexp_replace("cost_price"::text, ''[^0-9\\.-]'', '''', ''g''), '''')::numeric)::numeric(10, 2) ELSE NULL END END)';
  END IF;

  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'carts' AND column_name = 'retail_price';

  IF col_type = 'jsonb' THEN
    EXECUTE 'ALTER TABLE "carts" ALTER COLUMN "retail_price" TYPE numeric(10, 2) USING CASE WHEN "retail_price" ? ''total'' THEN (("retail_price"->>''total'')::numeric / 100) ELSE NULL END';
  ELSIF col_type IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "carts" ALTER COLUMN "retail_price" TYPE numeric(10, 2) USING (CASE WHEN NULLIF(regexp_replace("retail_price"::text, ''[^0-9\\.-]'', '''', ''g''), '''') IS NULL THEN NULL ELSE CASE WHEN abs((NULLIF(regexp_replace("retail_price"::text, ''[^0-9\\.-]'', '''', ''g''), '''')::numeric)) < 100000000 THEN (NULLIF(regexp_replace("retail_price"::text, ''[^0-9\\.-]'', '''', ''g''), '''')::numeric)::numeric(10, 2) ELSE NULL END END)';
  END IF;
END $$;