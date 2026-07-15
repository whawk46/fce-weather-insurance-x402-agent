// Package settlementtime defines when a coverage date may be settled:
// from 00:00 UTC on the day after the coverage date (past dates are already open).
package settlementtime

import (
	"fmt"
	"time"
)

// UnlockAt returns the earliest instant settlement is allowed for coverageDate (YYYY-MM-DD).
func UnlockAt(coverageDate string) (time.Time, error) {
	day, err := time.Parse("2006-01-02", coverageDate)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse coverage date %q: %w", coverageDate, err)
	}
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	return start.Add(24 * time.Hour), nil
}

// UnixUnlockAt is UnlockAt as Unix seconds (UTC).
func UnixUnlockAt(coverageDate string) (uint64, error) {
	t, err := UnlockAt(coverageDate)
	if err != nil {
		return 0, err
	}
	return uint64(t.Unix()), nil
}

// CanSettle reports whether settlement is allowed at now for the given coverage date.
func CanSettle(coverageDate string, now time.Time) (bool, error) {
	unlock, err := UnlockAt(coverageDate)
	if err != nil {
		return false, err
	}
	return !now.Before(unlock), nil
}
