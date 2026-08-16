-- Calabash Lab 创业看板 · Supabase 数据库结构
-- 在 Supabase 后台 -> SQL Editor 粘贴全部内容执行一次即可。

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  project       text not null default 'Calabash Lab',
  title         text not null,
  owner         text not null default '共同',
  status        text not null default '待分配池',
  progress      int  not null default 0,
  due           date,
  blocker       text default '',
  note          text default '',
  milestone     text default null,            -- 可选: SKU / 社媒 / 网站
  claimed_week  text default '',
  updated_week  text default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists meta (
  key   text primary key,
  value jsonb not null
);

-- MVP（私有两人工具）：允许 anon 全部读写，方便免登录使用。
-- 生产环境请改成基于 Supabase Auth 的行级安全策略。
alter table tasks enable row level security;
alter table meta  enable row level security;

drop policy if exists "allow all tasks" on tasks;
create policy "allow all tasks" on tasks for all using (true) with check (true);

drop policy if exists "allow all meta" on meta;
create policy "allow all meta" on meta for all using (true) with check (true);

-- 集市：一场集市 = 一个事件（日期/地点/状态），其筹备工作以 checklist(jsonb) 内嵌，
-- 不再拆成独立任务卡片。status: 商榷中 / 已申请。
create table if not exists markets (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  event_date  date,
  location    text default '',
  status      text not null default '商榷中',
  checklist   jsonb not null default '[
    {"n":"找场地 / 预约","done":false},
    {"n":"前一晚：上货充电收拾","done":false},
    {"n":"当天：摆货","done":false},
    {"n":"推销介绍","done":false},
    {"n":"收钱结账算账","done":false}
  ]'::jsonb,
  note        text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table markets enable row level security;
drop policy if exists "allow all markets" on markets;
create policy "allow all markets" on markets for all using (true) with check (true);
