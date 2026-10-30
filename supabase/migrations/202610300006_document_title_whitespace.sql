-- Match ECMAScript String.trim whitespace (including Unicode separators and
-- BOM), rather than PostgreSQL btrim's default ASCII-space-only behavior.
-- NOT VALID allows a non-destructive repair of any previously accepted blank
-- title before validating historical rows. IDs, ownership, rooms and access
-- grants are retained; the normal updated_at trigger records the repair.
alter table public.documents add constraint documents_title_not_blank
  check (length(btrim(title, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0)
  not valid;

update public.documents set title = '未命名文件'
where length(btrim(title, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) = 0;

alter table public.documents validate constraint documents_title_not_blank;
