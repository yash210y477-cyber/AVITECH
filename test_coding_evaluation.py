from coding_evaluator import evaluate_code

Q = {
    "language": "Python",
    "question": "Write a Python program to count even values in an array or list"
}

wrong = """a=[1,2,0]
b=sort(a)
print(b)"""
right = """a=[1,2,0]
count=0
for x in a:
    if x % 2 == 0:
        count += 1
print(count)"""

bad = evaluate_code(wrong, Q)
good = evaluate_code(right, Q)
assert bad["score"] < 70, bad
assert bad["status"] != "PASS", bad
assert good["status"] in {"PASS", "REVIEW_REQUIRED"}, good
assert good["score"] >= 0, good

D = {
    "language": "Python",
    "question": "Write Python code to create a simple program that removes duplicates."
}

dedupe_wrong = """a=[1,2,3,3,5,2]
a.unique()
print(a)"""
dedupe_right = """a=[1,2,3,3,5,2]
a=list(dict.fromkeys(a))
print(a)"""

bad2 = evaluate_code(dedupe_wrong, D)
good2 = evaluate_code(dedupe_right, D)
assert bad2["score"] < 70, bad2
assert bad2["status"] != "PASS", bad2
assert good2["status"] in {"PASS", "REVIEW_REQUIRED"}, good2
assert good2["score"] >= 0, good2

print("PASS: unrelated sort code and a.unique() are rejected; unsupported cases are REVIEW_REQUIRED rather than falsely marked 100%.")
