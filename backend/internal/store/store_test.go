package store

import "testing"

func TestTransitionMatrix(t *testing.T) {
	for _, actor := range []string{"user", "admin"} {
		for _, from := range []string{"new", "in_progress", "done"} {
			for _, to := range []string{"new", "in_progress", "done"} {
				allowed := (actor == "admin" && from == "new" && to == "in_progress") || (actor == "admin" && from == "in_progress" && to == "done") || (actor == "user" && from == "done" && to == "in_progress")
				if (ValidateTransition(actor, from, to, "Причина") == nil) != allowed {
					t.Errorf("%s: %s -> %s", actor, from, to)
				}
			}
		}
	}
	if ValidateTransition("admin", "new", "in_progress", "") != nil {
		t.Error("acceptance comment is optional per PDF")
	}
	if ValidateTransition("admin", "in_progress", "done", " \n") == nil || ValidateTransition("user", "done", "in_progress", "") == nil {
		t.Error("required result/reason")
	}
}

func TestValidation(t *testing.T) {
	validTopics := map[string]bool{"access": true, "service": true, "other": true}
	for topic := range validTopics {
		if !ValidTopic(topic) {
			t.Errorf("topic %q should be valid", topic)
		}
	}
	for _, topic := range []string{"", "billing", "ACCESS"} {
		if ValidTopic(topic) {
			t.Errorf("topic %q should be invalid", topic)
		}
	}
	if !ValidText(" ok ", 10) || ValidText("   ", 10) || ValidText("abcdefghijk", 10) {
		t.Error("ValidText must trim, reject blank and enforce the rune limit")
	}
}
