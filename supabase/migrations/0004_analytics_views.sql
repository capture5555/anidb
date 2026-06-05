-- 分析用の集計ビュー（制作会社・声優・シーズン本数）。
-- サーバー(service role)から参照する。

-- 制作会社別: 制作本数と平均人気度
create or replace view v_studio_stats as
select ws.person_name as studio,
       count(distinct ws.work_id) as work_count,
       round(avg(w.popularity))::int as avg_popularity
from work_staff ws
join works w on w.id = ws.work_id
where ws.role = 'アニメーション制作' and coalesce(ws.person_name, '') <> ''
group by ws.person_name;

-- 制作会社×年: 年ごとの本数推移
create or replace view v_studio_year as
select ws.person_name as studio, w.season_year as year,
       count(distinct ws.work_id) as work_count
from work_staff ws
join works w on w.id = ws.work_id
where ws.role = 'アニメーション制作' and coalesce(ws.person_name, '') <> '' and w.season_year is not null
group by ws.person_name, w.season_year;

-- 声優別: 出演作品数
create or replace view v_va_ranking as
select person_name, count(distinct work_id) as work_count
from work_casts
where coalesce(person_name, '') <> ''
group by person_name;

-- シーズン別: 本数
create or replace view v_season_volume as
select season_year, season_name, count(*) as work_count
from works
where season_year is not null and season_name is not null
group by season_year, season_name;
