"""
write_neo4j.py 的 TDD 测试（集成测试：需要 Neo4j 运行中）
验证：连接、写入节点、写入关系、幂等性
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_neo4j_connection():
    """测试 Neo4j 连接"""
    from scripts.write_neo4j import connect_neo4j
    from config import NEO4J_CONFIG

    driver = connect_neo4j(NEO4J_CONFIG)
    assert driver is not None, "应返回 driver 对象"

    # 验证连接
    with driver.session() as session:
        result = session.run("RETURN 1 AS n")
        record = result.single()
        assert record["n"] == 1, "应返回 1"

    driver.close()
    print("[PASS] Neo4j connection OK")
    return True


def test_create_node():
    """测试创建节点"""
    from scripts.write_neo4j import connect_neo4j, clear_all_data
    from config import NEO4J_CONFIG

    driver = connect_neo4j(NEO4J_CONFIG)

    # 清理
    clear_all_data(driver)

    # 创建单个节点
    with driver.session() as session:
        session.run(
            "CREATE (n:LandUse {name: $name, code: $code, level: $level})",
            name="测试用地", code="9999", level="中类"
        )

    # 验证
    with driver.session() as session:
        result = session.run(
            "MATCH (n:LandUse {code: '9999'}) RETURN n.name AS name"
        )
        record = result.single()
        assert record is not None, "应找到创建的节点"
        assert record["name"] == "测试用地", "节点名称应匹配"

    # 清理
    clear_all_data(driver)
    driver.close()
    print("[PASS] create node OK")
    return True


def test_create_relation():
    """测试创建关系"""
    from scripts.write_neo4j import connect_neo4j, clear_all_data
    from config import NEO4J_CONFIG

    driver = connect_neo4j(NEO4J_CONFIG)
    clear_all_data(driver)

    with driver.session() as session:
        # 创建两个节点
        session.run("CREATE (a:LandUse {name: '大类A', code: '99'})")
        session.run("CREATE (b:LandUse {name: '中类B', code: '9999'})")
        # 创建关系
        session.run(
            """MATCH (a:LandUse {code: '99'}), (b:LandUse {code: '9999'})
               MERGE (b)-[:BELONGS_TO]->(a)"""
        )

    # 验证
    with driver.session() as session:
        result = session.run(
            """MATCH (b:LandUse {code: '9999'})-[r:BELONGS_TO]->(a:LandUse {code: '99'})
               RETURN type(r) AS rel"""
        )
        record = result.single()
        assert record is not None, "应找到关系"
        assert record["rel"] == "BELONGS_TO", "关系类型应匹配"

    clear_all_data(driver)
    driver.close()
    print("[PASS] create relation OK")
    return True


def test_write_landuse_nodes():
    """测试批量写入用地分类节点"""
    from scripts.write_neo4j import connect_neo4j, clear_all_data, write_landuse_nodes
    from config import NEO4J_CONFIG

    test_nodes = [
        {"name": "耕地", "code": "01", "level": "大类", "parent_code": None},
        {"name": "水田", "code": "0101", "level": "中类", "parent_code": "01"},
        {"name": "旱地", "code": "0103", "level": "中类", "parent_code": "01"},
    ]

    driver = connect_neo4j(NEO4J_CONFIG)
    clear_all_data(driver)

    count = write_landuse_nodes(driver, test_nodes)
    assert count == 3, f"应写入 3 个节点，实际 {count}"

    # 验证节点数
    with driver.session() as session:
        result = session.run("MATCH (n:LandUse) RETURN count(n) AS c")
        assert result.single()["c"] == 3

        # 验证关系
        result2 = session.run("MATCH ()-[r:BELONGS_TO]->() RETURN count(r) AS c")
        assert result2.single()["c"] == 2, "应有 2 条 BELONGS_TO 关系"

    clear_all_data(driver)
    driver.close()
    print("[PASS] write landuse nodes OK")
    return True


if __name__ == "__main__":
    test_neo4j_connection()
    test_create_node()
    test_create_relation()
    test_write_landuse_nodes()
