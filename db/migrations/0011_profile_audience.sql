-- Who the user's videos are for and what they want viewers to buy or do: used for call-outs in hooks
-- and for calls to action.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT '';
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS offer TEXT NOT NULL DEFAULT '';
