from scripts.entity_quality import validate_entity


VALID_CASES = [
    ("钒钛磁铁矿", "Mineral"),
    ("辉长岩", "Rock"),
    ("晚二叠世", "TimePeriod"),
    ("阿尔金断裂带", "Structure"),
    ("岩浆分异-贯入-热液型", "DepositType"),
    ("VMS", "DepositType"),
]

INVALID_CASES = [
    ("201", "Mineral"),
    (".20", "Mineral"),
    ("osi", "Rock"),
    ("，主要", "Rock"),
    ("分别为", "Mineral"),
    ("铁矿矿", "Mineral"),
    ("金属矿", "TimePeriod"),
    ("斜长石", "Rock"),
]


for name, entity_type in VALID_CASES:
    result = validate_entity(name, entity_type)
    assert result.valid, (name, entity_type, result.reason)

for name, entity_type in INVALID_CASES:
    result = validate_entity(name, entity_type)
    assert not result.valid, (name, entity_type)

print("entity quality assertions passed")
