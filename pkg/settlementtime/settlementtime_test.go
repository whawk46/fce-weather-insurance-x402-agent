package settlementtime

import (
	"testing"
	"time"
)

func TestUnixUnlockAt_midnightUtcNextDay(t *testing.T) {
	tests := []struct {
		date string
		want int64
	}{
		// 2026-06-04 coverage → unlock 2026-06-05 00:00 UTC
		{"2026-06-04", 1780617600},
		{"2026-01-15", 1768521600},
	}
	for _, tc := range tests {
		got, err := UnixUnlockAt(tc.date)
		if err != nil {
			t.Fatalf("%s: %v", tc.date, err)
		}
		if int64(got) != tc.want {
			t.Fatalf("%s: got %d want %d", tc.date, got, tc.want)
		}
	}
}

func TestCanSettle_pastDate(t *testing.T) {
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	ok, err := CanSettle("2026-06-04", now)
	if err != nil || !ok {
		t.Fatalf("past coverage: ok=%v err=%v", ok, err)
	}
}

func TestCanSettle_sameDayBeforeMidnight(t *testing.T) {
	now := time.Date(2026, 6, 4, 23, 0, 0, 0, time.UTC)
	ok, err := CanSettle("2026-06-04", now)
	if err != nil || ok {
		t.Fatalf("before next midnight: ok=%v err=%v", ok, err)
	}
}

func TestCanSettle_sameDayAfterMidnight(t *testing.T) {
	now := time.Date(2026, 6, 5, 0, 1, 0, 0, time.UTC)
	ok, err := CanSettle("2026-06-04", now)
	if err != nil || !ok {
		t.Fatalf("after next midnight: ok=%v err=%v", ok, err)
	}
}
