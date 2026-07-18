//! Platform-neutral port of Gravity's window geometry engine.

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn center(self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    pub fn approximately(self, other: Self, tolerance: f64) -> bool {
        (self.x - other.x).abs() <= tolerance
            && (self.y - other.y).abs() <= tolerance
            && (self.width - other.width).abs() <= tolerance
            && (self.height - other.height).abs() <= tolerance
    }

    pub fn rounded(self) -> Self {
        Self::new(
            self.x.round(),
            self.y.round(),
            self.width.round(),
            self.height.round(),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UnitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl UnitRect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn resolve(self, visible: Rect, gap: f64) -> Rect {
        let raw = Rect::new(
            visible.x + self.x * visible.width,
            visible.y + self.y * visible.height,
            self.width * visible.width,
            self.height * visible.height,
        );
        if gap <= 0.0 {
            return raw.rounded();
        }
        let eps = 0.0001;
        let left = if self.x <= eps { gap } else { gap / 2.0 };
        let right = if self.x + self.width >= 1.0 - eps {
            gap
        } else {
            gap / 2.0
        };
        let top = if self.y <= eps { gap } else { gap / 2.0 };
        let bottom = if self.y + self.height >= 1.0 - eps {
            gap
        } else {
            gap / 2.0
        };
        Rect::new(
            raw.x + left,
            raw.y + top,
            (raw.width - left - right).max(0.0),
            (raw.height - top - bottom).max(0.0),
        )
        .rounded()
    }

    pub fn from_rect(rect: Rect, visible: Rect) -> Self {
        if visible.width <= 0.0 || visible.height <= 0.0 {
            return Self::new(0.0, 0.0, 1.0, 1.0);
        }
        Self::new(
            (rect.x - visible.x) / visible.width,
            (rect.y - visible.y) / visible.height,
            rect.width / visible.width,
            rect.height / visible.height,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    LeftHalf,
    RightHalf,
    TopHalf,
    BottomHalf,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    FirstThird,
    CenterThird,
    LastThird,
    FirstTwoThirds,
    LastTwoThirds,
    SixthTopLeft,
    SixthTopCenter,
    SixthTopRight,
    SixthBottomLeft,
    SixthBottomCenter,
    SixthBottomRight,
    Maximize,
    AlmostMaximize,
    Center,
}

impl Placement {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "left-half" => Self::LeftHalf,
            "right-half" => Self::RightHalf,
            "top-half" => Self::TopHalf,
            "bottom-half" => Self::BottomHalf,
            "top-left" => Self::TopLeft,
            "top-right" => Self::TopRight,
            "bottom-left" => Self::BottomLeft,
            "bottom-right" => Self::BottomRight,
            "first-third" => Self::FirstThird,
            "center-third" => Self::CenterThird,
            "last-third" => Self::LastThird,
            "first-two-thirds" => Self::FirstTwoThirds,
            "last-two-thirds" => Self::LastTwoThirds,
            "sixth-top-left" => Self::SixthTopLeft,
            "sixth-top-center" => Self::SixthTopCenter,
            "sixth-top-right" => Self::SixthTopRight,
            "sixth-bottom-left" => Self::SixthBottomLeft,
            "sixth-bottom-center" => Self::SixthBottomCenter,
            "sixth-bottom-right" => Self::SixthBottomRight,
            "maximize" => Self::Maximize,
            "almost-maximize" => Self::AlmostMaximize,
            "center" => Self::Center,
            _ => return None,
        })
    }

    pub fn is_cycle_half(self) -> bool {
        matches!(
            self,
            Self::LeftHalf | Self::RightHalf | Self::TopHalf | Self::BottomHalf
        )
    }

    fn unit_rect(self, portrait: bool) -> Option<UnitRect> {
        let third = 1.0 / 3.0;
        Some(match self {
            Self::LeftHalf => UnitRect::new(0.0, 0.0, 0.5, 1.0),
            Self::RightHalf => UnitRect::new(0.5, 0.0, 0.5, 1.0),
            Self::TopHalf => UnitRect::new(0.0, 0.0, 1.0, 0.5),
            Self::BottomHalf => UnitRect::new(0.0, 0.5, 1.0, 0.5),
            Self::TopLeft => UnitRect::new(0.0, 0.0, 0.5, 0.5),
            Self::TopRight => UnitRect::new(0.5, 0.0, 0.5, 0.5),
            Self::BottomLeft => UnitRect::new(0.0, 0.5, 0.5, 0.5),
            Self::BottomRight => UnitRect::new(0.5, 0.5, 0.5, 0.5),
            Self::FirstThird | Self::CenterThird | Self::LastThird => {
                let index = match self {
                    Self::FirstThird => 0.0,
                    Self::CenterThird => 1.0,
                    _ => 2.0,
                };
                if portrait {
                    UnitRect::new(0.0, index * third, 1.0, third)
                } else {
                    UnitRect::new(index * third, 0.0, third, 1.0)
                }
            }
            Self::FirstTwoThirds | Self::LastTwoThirds => {
                let origin = if self == Self::FirstTwoThirds {
                    0.0
                } else {
                    third
                };
                if portrait {
                    UnitRect::new(0.0, origin, 1.0, 2.0 * third)
                } else {
                    UnitRect::new(origin, 0.0, 2.0 * third, 1.0)
                }
            }
            Self::SixthTopLeft => sixth(0, portrait),
            Self::SixthTopCenter => sixth(1, portrait),
            Self::SixthTopRight => sixth(2, portrait),
            Self::SixthBottomLeft => sixth(3, portrait),
            Self::SixthBottomCenter => sixth(4, portrait),
            Self::SixthBottomRight => sixth(5, portrait),
            Self::Maximize => UnitRect::new(0.0, 0.0, 1.0, 1.0),
            Self::AlmostMaximize | Self::Center => return None,
        })
    }
}

fn sixth(index: usize, portrait: bool) -> UnitRect {
    if portrait {
        UnitRect::new(
            (index % 2) as f64 * 0.5,
            (index / 2) as f64 / 3.0,
            0.5,
            1.0 / 3.0,
        )
    } else {
        UnitRect::new(
            (index % 3) as f64 / 3.0,
            (index / 3) as f64 * 0.5,
            1.0 / 3.0,
            0.5,
        )
    }
}

pub fn target(placement: Placement, current: Rect, visible: Rect, gap: f64, cycling: bool) -> Rect {
    if placement == Placement::Center {
        return centered(current.width, current.height, visible);
    }
    if placement == Placement::AlmostMaximize {
        return centered(
            (visible.width * 0.92).round(),
            (visible.height * 0.92).round(),
            visible,
        );
    }
    if cycling && placement.is_cycle_half() {
        let stages = cycle_stages(placement, visible, gap);
        if let Some(index) = stages
            .iter()
            .position(|stage| stage.approximately(current, 4.0))
        {
            return stages[(index + 1) % stages.len()];
        }
        return stages[0];
    }
    placement
        .unit_rect(visible.height > visible.width)
        .unwrap_or(UnitRect::new(0.0, 0.0, 1.0, 1.0))
        .resolve(visible, gap)
}

pub fn cycle_stages(placement: Placement, visible: Rect, gap: f64) -> Vec<Rect> {
    [0.5, 2.0 / 3.0, 1.0 / 3.0]
        .into_iter()
        .map(|fraction| half_unit(placement, fraction).resolve(visible, gap))
        .collect()
}

fn half_unit(placement: Placement, fraction: f64) -> UnitRect {
    match placement {
        Placement::LeftHalf => UnitRect::new(0.0, 0.0, fraction, 1.0),
        Placement::RightHalf => UnitRect::new(1.0 - fraction, 0.0, fraction, 1.0),
        Placement::TopHalf => UnitRect::new(0.0, 0.0, 1.0, fraction),
        Placement::BottomHalf => UnitRect::new(0.0, 1.0 - fraction, 1.0, fraction),
        _ => UnitRect::new(0.0, 0.0, 1.0, 1.0),
    }
}

pub fn centered(width: f64, height: f64, visible: Rect) -> Rect {
    let width = width.min(visible.width);
    let height = height.min(visible.height);
    Rect::new(
        visible.x + (visible.width - width) / 2.0,
        visible.y + (visible.height - height) / 2.0,
        width,
        height,
    )
    .rounded()
}

pub fn grid_frames(count: usize, visible: Rect, gap: f64) -> Vec<Rect> {
    if count == 0 {
        return Vec::new();
    }
    if count == 1 {
        return vec![UnitRect::new(0.0, 0.0, 1.0, 1.0).resolve(visible, gap)];
    }
    let aspect = visible.width / visible.height.max(1.0);
    let mut columns = ((count as f64 * aspect).sqrt().round() as usize)
        .max(1)
        .min(count);
    if columns == 0 {
        columns = 1;
    }
    let rows = count.div_ceil(columns);
    let mut result = Vec::with_capacity(count);
    let mut placed = 0;
    for row in 0..rows {
        let in_row = columns.min(count - placed);
        for column in 0..in_row {
            result.push(
                UnitRect::new(
                    column as f64 / in_row as f64,
                    row as f64 / rows as f64,
                    1.0 / in_row as f64,
                    1.0 / rows as f64,
                )
                .resolve(visible, gap),
            );
        }
        placed += in_row;
    }
    result
}

pub fn scaled(frame: Rect, factor: f64, visible: Rect) -> Rect {
    let width = (frame.width * factor).clamp(320.0, visible.width);
    let height = (frame.height * factor).clamp(240.0, visible.height);
    Rect::new(
        (frame.center().0 - width / 2.0).clamp(visible.x, visible.x + visible.width - width),
        (frame.center().1 - height / 2.0).clamp(visible.y, visible.y + visible.height - height),
        width,
        height,
    )
    .rounded()
}

pub fn cascade_frames(count: usize, visible: Rect) -> Vec<Rect> {
    let width = (visible.width * 0.6).round();
    let height = (visible.height * 0.6).round();
    (0..count)
        .map(|index| {
            let offset = index as f64 * 36.0;
            Rect::new(
                (visible.x + 24.0 + offset).min(visible.x + visible.width - width - 8.0),
                (visible.y + 24.0 + offset).min(visible.y + visible.height - height - 8.0),
                width,
                height,
            )
            .rounded()
        })
        .collect()
}

pub fn transpose(frame: Rect, source: Rect, destination: Rect) -> Rect {
    UnitRect::from_rect(frame, source).resolve(destination, 0.0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusDirection {
    Left,
    Right,
    Up,
    Down,
}

pub fn nearest(origin: Rect, candidates: &[Rect], direction: FocusDirection) -> Option<usize> {
    let from = origin.center();
    candidates
        .iter()
        .enumerate()
        .filter_map(|(index, rect)| {
            let center = rect.center();
            let (primary, orthogonal) = match direction {
                FocusDirection::Left => (from.0 - center.0, (center.1 - from.1).abs()),
                FocusDirection::Right => (center.0 - from.0, (center.1 - from.1).abs()),
                FocusDirection::Up => (from.1 - center.1, (center.0 - from.0).abs()),
                FocusDirection::Down => (center.1 - from.1, (center.0 - from.0).abs()),
            };
            (primary > 1.0).then_some((index, primary + orthogonal * 1.5))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|value| value.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect {
        x: 0.0,
        y: 30.0,
        width: 1200.0,
        height: 770.0,
    };

    #[test]
    fn halves_and_quarters_match_gravity() {
        let current = Rect::new(20.0, 50.0, 600.0, 500.0);
        assert_eq!(
            target(Placement::LeftHalf, current, SCREEN, 0.0, false),
            Rect::new(0.0, 30.0, 600.0, 770.0)
        );
        assert_eq!(
            target(Placement::BottomRight, current, SCREEN, 0.0, false),
            Rect::new(600.0, 415.0, 600.0, 385.0)
        );
    }

    #[test]
    fn repeated_half_cycles_half_two_thirds_one_third() {
        let current = target(Placement::LeftHalf, Rect::default(), SCREEN, 0.0, false);
        let next = target(Placement::LeftHalf, current, SCREEN, 0.0, true);
        assert_eq!(next.width, 800.0);
        let third = target(Placement::LeftHalf, next, SCREEN, 0.0, true);
        assert_eq!(third.width, 400.0);
    }

    #[test]
    fn gaps_are_shared_between_adjacent_zones() {
        let left = UnitRect::new(0.0, 0.0, 0.5, 1.0).resolve(SCREEN, 12.0);
        let right = UnitRect::new(0.5, 0.0, 0.5, 1.0).resolve(SCREEN, 12.0);
        assert_eq!(right.x - (left.x + left.width), 12.0);
    }

    #[test]
    fn grid_fills_the_last_row() {
        let frames = grid_frames(5, SCREEN, 0.0);
        assert_eq!(frames.len(), 5);
        let last_row = &frames[3..];
        assert_eq!(last_row[0].width, 600.0);
        assert_eq!(last_row[1].x, 600.0);
    }

    #[test]
    fn directional_focus_penalizes_sideways_offset() {
        let origin = Rect::new(500.0, 400.0, 100.0, 100.0);
        let candidates = [
            Rect::new(700.0, 410.0, 100.0, 100.0),
            Rect::new(600.0, 50.0, 100.0, 100.0),
        ];
        assert_eq!(nearest(origin, &candidates, FocusDirection::Right), Some(0));
    }

    #[test]
    fn transpose_preserves_relative_geometry() {
        let destination = Rect::new(1200.0, 0.0, 1920.0, 1080.0);
        let result = transpose(Rect::new(600.0, 415.0, 600.0, 385.0), SCREEN, destination);
        assert_eq!(result, Rect::new(2160.0, 540.0, 960.0, 540.0));
    }
}
