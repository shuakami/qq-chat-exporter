use chrono::{DateTime, Datelike, LocalResult, NaiveDate, TimeZone, Timelike};

/// 已解析的五字段 Cron；星期沿用 1（周一）到 7（周日），日期和星期同时匹配。
struct CronSchedule {
    minutes: Vec<u32>,
    hours: Vec<u32>,
    days: Vec<u32>,
    months: Vec<u32>,
    weekdays: Vec<u32>,
}

impl CronSchedule {
    fn parse(expression: &str) -> Result<Self, String> {
        let parts: Vec<_> = expression.split_whitespace().collect();
        if parts.len() != 5 {
            return Err("Cron 表达式必须包含五个字段".to_owned());
        }
        Ok(Self {
            minutes: parse_field(parts[0], 0, 59)?,
            hours: parse_field(parts[1], 0, 23)?,
            days: parse_field(parts[2], 1, 31)?,
            months: parse_field(parts[3], 1, 12)?,
            weekdays: parse_field(parts[4], 1, 7)?,
        })
    }

    /// 两条调度路径共用日期匹配，保留原有的「日且星期」语义。
    fn matches_date(&self, date: NaiveDate) -> bool {
        self.days.contains(&date.day())
            && self.months.contains(&date.month())
            && self.weekdays.contains(&date.weekday().number_from_monday())
    }
}

/// 展开现有语法：数值、列表、通配符及 */步长；完整拒绝非法字段。
fn parse_field(pattern: &str, min: u32, max: u32) -> Result<Vec<u32>, String> {
    let invalid = || format!("无效的 Cron 字段: {pattern}（范围 {min}..={max}）");
    let mut values = Vec::new();
    for item in pattern.split(',') {
        let item = item.trim();
        if item == "*" {
            values.extend(min..=max);
        } else if let Some(step) = item.strip_prefix("*/") {
            let step = step.parse::<u32>().map_err(|_| invalid())?;
            if step == 0 {
                return Err(invalid());
            }
            // 保留原匹配器按字段值取余的步长语义（包括日、月、星期字段）。
            values.extend((min..=max).filter(|value| value % step == 0));
        } else {
            let value = item.parse::<u32>().map_err(|_| invalid())?;
            if !(min..=max).contains(&value) {
                return Err(invalid());
            }
            values.push(value);
        }
    }
    // 去重并排序，让列表顺序不影响下次执行时间。
    values.sort_unstable();
    values.dedup();
    if values.is_empty() {
        return Err(invalid());
    }
    Ok(values)
}

/// 判断当前本地时刻是否命中 Cron；非法表达式不会执行。
#[must_use]
pub fn should_execute<Tz: TimeZone>(cron_expression: &str, now: &DateTime<Tz>) -> bool {
    CronSchedule::parse(cron_expression).is_ok_and(|schedule| {
        schedule.matches_date(now.date_naive())
            && schedule.hours.contains(&now.hour())
            && schedule.minutes.contains(&now.minute())
    })
}

/// 按同一套 Cron 规则计算严格晚于 now 的时刻，保留调用者的本地时区。
pub fn next_run_after<Tz: TimeZone>(
    cron_expression: &str,
    now: &DateTime<Tz>,
) -> Result<DateTime<Tz>, String> {
    let schedule = CronSchedule::parse(cron_expression)?;
    let timezone = now.timezone();
    let mut date = now.date_naive();
    // 公历日期和星期每 400 年重复一次；按日搜索，避免稀疏或无解表达式逐分钟空转。
    for _ in 0..=146_097 {
        if schedule.matches_date(date) {
            let mut next = None;
            for &hour in &schedule.hours {
                for &minute in &schedule.minutes {
                    // 字段已校验范围，因此这里一定能构造整分钟的本地时间。
                    let local = date
                        .and_hms_opt(hour, minute, 0)
                        .expect("validated Cron time");
                    // 夏令时跳过的时间不执行；回拨产生的两个时刻都参与比较。
                    let candidates = match timezone.from_local_datetime(&local) {
                        LocalResult::None => [None, None],
                        LocalResult::Single(time) => [Some(time), None],
                        LocalResult::Ambiguous(first, second) => [Some(first), Some(second)],
                    };
                    for candidate in candidates.into_iter().flatten() {
                        // 严格排除当前时刻；按实际时间比较，正确处理回拨后的较早钟面时间。
                        if candidate > *now && next.as_ref().is_none_or(|best| candidate < *best) {
                            next = Some(candidate);
                        }
                    }
                }
            }
            if let Some(next) = next {
                return Ok(next);
            }
        }
        // 到达 Chrono 日期上限时显式报错，不制造执行时间。
        date = date.succ_opt().ok_or("Cron 搜索超出日期范围")?;
    }
    Err("Cron 表达式在一个 400 年公历周期内没有可执行时间".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, FixedOffset, Local};

    fn time(value: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(value).unwrap()
    }

    #[test]
    fn next_run_covers_daily_times_and_calendar_boundaries() {
        // 固定 +08:00，覆盖首个时刻之前、两个时刻之间、末次之后及日期进位。
        let cases = [
            (
                "0 10,22 * * *",
                "2026-10-17T08:06:00+08:00",
                "2026-10-17T10:00:00+08:00",
            ),
            (
                "0 10,22 * * *",
                "2026-10-17T10:00:00+08:00",
                "2026-10-17T22:00:00+08:00",
            ),
            (
                "0 10,22 * * *",
                "2026-10-17T15:30:42+08:00",
                "2026-10-17T22:00:00+08:00",
            ),
            (
                "0 10,22 * * *",
                "2026-10-17T22:00:00.001+08:00",
                "2026-10-18T10:00:00+08:00",
            ),
            (
                "0 10,22 * * *",
                "2026-10-31T23:00:00+08:00",
                "2026-11-01T10:00:00+08:00",
            ),
            (
                "0 10,22 * * *",
                "2026-12-31T23:00:00+08:00",
                "2027-01-01T10:00:00+08:00",
            ),
            (
                "30 2 * * *",
                "2026-10-17T08:06:00+08:00",
                "2026-10-18T02:30:00+08:00",
            ),
            (
                "0 0 29 2 *",
                "2096-03-01T00:00:00+08:00",
                "2104-02-29T00:00:00+08:00",
            ),
        ];
        for (expression, current, expected) in cases {
            let now = time(current);
            let next = next_run_after(expression, &now).unwrap();
            assert_eq!(next, time(expected), "{expression}: {current}");
            assert!(next > now);
            assert!(should_execute(expression, &next));
        }
    }

    #[test]
    fn shared_matching_preserves_supported_syntax() {
        // 特别验证列表中的步长、非零起点字段取余，以及日/星期的交集。
        let cases = [
            (
                "* * * * *",
                "2026-10-17T08:06:12.345+08:00",
                "2026-10-17T08:07:00+08:00",
            ),
            (
                "*/15 * * * *",
                "2026-10-17T08:06:00+08:00",
                "2026-10-17T08:15:00+08:00",
            ),
            (
                "45,*/20 22,10 * * *",
                "2026-10-17T10:46:00+08:00",
                "2026-10-17T22:00:00+08:00",
            ),
            (
                "0 */6 * * *",
                "2026-10-17T08:06:00+08:00",
                "2026-10-17T12:00:00+08:00",
            ),
            (
                "0 0 */2 */2 */2",
                "2026-10-17T08:06:00+08:00",
                "2026-10-20T00:00:00+08:00",
            ),
            (
                "0 10 18 * 1",
                "2026-10-17T08:06:00+08:00",
                "2027-01-18T10:00:00+08:00",
            ),
            (
                "0 10 * * 7",
                "2026-10-17T08:06:00+08:00",
                "2026-10-18T10:00:00+08:00",
            ),
            (
                " 0\t10   * * * ",
                "2026-10-17T08:06:00+08:00",
                "2026-10-17T10:00:00+08:00",
            ),
        ];
        for (expression, current, expected) in cases {
            let now = time(current);
            let next = next_run_after(expression, &now).unwrap();
            assert_eq!(next, time(expected), "{expression}");
            assert!(next > now);
            assert!(should_execute(expression, &next));
        }
    }

    #[test]
    fn invalid_or_impossible_cron_has_no_next_run() {
        let now = time("2026-10-17T08:06:00+08:00");
        for expression in [
            "",
            "* * *",
            "* * * * * *",
            "60 * * * *",
            "0 24 * * *",
            "0 0 0 * *",
            "0 0 * 13 *",
            "0 0 * * 0",
            "*/0 * * * *",
            "*/x * * * *",
            "*/2/3 * * * *",
            "1-5 * * * *",
            "0,no * * * *",
            "0, * * * *",
            "0 0 */32 * *",
        ] {
            assert!(next_run_after(expression, &now).is_err(), "{expression}");
            assert!(!should_execute(expression, &now), "{expression}");
        }
        // 语法合法但公历无解，搜索必须有界结束。
        assert!(next_run_after("0 0 31 2 *", &now).is_err());
    }

    #[test]
    fn next_run_agrees_with_elapsed_minutes_across_local_clock_changes() {
        // 在 TZ=America/New_York 下覆盖春季跳时和秋季回拨；其他时区同样固定可复现。
        for (expression, current) in [
            ("30 2 * * *", "2026-03-08T01:59:00-05:00"),
            ("30 1 * * *", "2026-11-01T01:45:00-04:00"),
            ("30 1 * * *", "2026-11-01T01:30:00-05:00"),
        ] {
            let now = time(current).with_timezone(&Local);
            // 独立按真实流逝分钟枚举，检查本地时间搜索没有漏掉重叠或虚构缺失时刻。
            let expected = (1..=48 * 60)
                .map(|minute| now + Duration::minutes(minute))
                .find(|candidate| should_execute(expression, candidate))
                .unwrap();
            assert_eq!(next_run_after(expression, &now).unwrap(), expected);
        }
    }
}
