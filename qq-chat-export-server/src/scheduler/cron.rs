use chrono::{Datelike, Timelike};

/// 判断当前时刻是否命中 cron 表达式。
#[must_use]
pub fn should_execute(cron_expression: &str, now: &chrono::DateTime<chrono::Local>) -> bool {
    let parts: Vec<&str> = cron_expression.split(' ').collect();
    if parts.len() != 5 {
        return false;
    }
    let minute = now.minute();
    let hour = now.hour();
    let day = now.day();
    let month = now.month();
    let weekday = now.weekday().num_days_from_sunday(); // 0 = 周日
    let weekday = if weekday == 0 { 7 } else { weekday };

    matches_part(parts[0], minute)
        && matches_part(parts[1], hour)
        && matches_part(parts[2], day)
        && matches_part(parts[3], month)
        && matches_part(parts[4], weekday)
}

/// 匹配单个字段。
fn matches_part(pattern: &str, value: u32) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern.contains(',') {
        return pattern
            .split(',')
            .any(|p| matches_part(p.trim(), value));
    }
    if pattern.contains('/') {
        let mut split = pattern.split('/');
        let range = split.next().unwrap_or("*");
        let step = split.next().unwrap_or("1");
        if let Ok(step_value) = step.parse::<u32>() {
            if range == "*" && step_value > 0 {
                return value % step_value == 0;
            }
        }
        return false;
    }
    pattern.parse::<u32>().is_ok_and(|parsed| parsed == value)
}

#[cfg(test)]
mod tests {
    use super::matches_part;

    #[test]
    fn wildcard_matches_all() {
        assert!(matches_part("*", 0));
        assert!(matches_part("*", 59));
    }

    #[test]
    fn exact_and_list() {
        assert!(matches_part("5", 5));
        assert!(!matches_part("5", 6));
        assert!(matches_part("1,3,5", 3));
        assert!(!matches_part("1,3,5", 2));
    }

    #[test]
    fn step_pattern() {
        assert!(matches_part("*/15", 0));
        assert!(matches_part("*/15", 30));
        assert!(!matches_part("*/15", 20));
    }
}
