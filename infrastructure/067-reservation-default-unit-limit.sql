-- New spaces allow one monthly reservation per apartment unless the manager
-- chooses a different limit. Explicit NULL remains unlimited. Preserve all
-- existing settings, including spaces already configured without a limit.
ALTER TABLE public.common_areas ALTER COLUMN monthly_limit_per_unit SET DEFAULT 1;
