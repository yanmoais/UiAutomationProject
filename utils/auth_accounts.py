# -*- coding: utf-8 -*-
import os
import yaml
from config.logger import log_info
from typing import Dict, Any, List, Optional, Set
from faker import Faker


_BASE_DIR = 'Auth_Data'
_FILE_NAME = 'auth_accounts.yaml'

os.makedirs(_BASE_DIR, exist_ok=True)
_FILE_PATH = os.path.join(_BASE_DIR, _FILE_NAME)

faker = Faker()


def _load_yaml() -> Dict[str, Any]:
    if not os.path.exists(_FILE_PATH):
        return {}
    with open(_FILE_PATH, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f) or {}
    return data


def _save_yaml(data: Dict[str, Any]) -> None:
    with open(_FILE_PATH, 'w', encoding='utf-8') as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)


def read_accounts(project_name: str, file_name: str) -> Dict[str, Dict[str, str]]:
    data = _load_yaml()
    entry = data.get(project_name, {}).get(file_name, {})
    # 兼容：如果是新结构，读取 by_address；如果是旧结构，直接返回字典
    if isinstance(entry, dict) and 'by_address' in entry:
        return entry.get('by_address', {}) or {}
    return entry or {}


def write_accounts(
    project_name: str,
    file_name: str,
    accounts: Dict[str, Dict[str, str]],
    accounts_list: Optional[List[Dict[str, str]]] = None,
    accounts_slots: Optional[Dict[str, Dict[str, str]]] = None,
    product_address_slots: Optional[Dict[str, str]] = None,
) -> None:
    data = _load_yaml()
    if project_name not in data:
        data[project_name] = {}
    if file_name not in data[project_name]:
        data[project_name][file_name] = {}

    # 新结构节点
    if not isinstance(data[project_name][file_name], dict):
        data[project_name][file_name] = {}

    node = data[project_name][file_name]

    # 合并 by_address（后写覆盖同地址）
    if 'by_address' not in node or not isinstance(node['by_address'], dict):
        node['by_address'] = {}
    for addr, info in (accounts or {}).items():
        node['by_address'][addr] = {
            'email': (info or {}).get('email', ''),
            'password': (info or {}).get('password', '')
        }

    # 覆盖 by_order（按当前保存覆盖，保留重复与顺序）
    if accounts_list is not None:
        safe_list: List[Dict[str, str]] = []
        for item in accounts_list:
            if not isinstance(item, dict):
                continue
            safe_list.append({
                'address': (item.get('address') or '').strip(),
                'email': item.get('email', ''),
                'password': item.get('password', '')
            })
        node['by_order'] = safe_list

    # 覆盖 by_slot（SCS_1, SCS_2 ...）
    if accounts_slots is not None:
        safe_slots: Dict[str, Dict[str, str]] = {}
        for slot_key, info in (accounts_slots or {}).items():
            if not slot_key:
                continue
            safe_slots[str(slot_key)] = {
                'address': (info or {}).get('address', ''),
                'email': (info or {}).get('email', ''),
                'password': (info or {}).get('password', '')
            }
        node['by_slot'] = safe_slots

    # 保存产品地址的槽位映射（便于调试/回显）
    if product_address_slots is not None:
        safe_pa: Dict[str, str] = {}
        for slot_key, addr in (product_address_slots or {}).items():
            if not slot_key:
                continue
            safe_pa[str(slot_key)] = (addr or '').strip()
        node['product_address_slots'] = safe_pa

    data[project_name][file_name] = node
    _save_yaml(data)


def read_accounts_list(project_name: str, file_name: str) -> List[Dict[str, str]]:
    """读取按顺序保存的账号列表（包含重复）。
    如果不存在，则返回空列表。
    兼容旧结构：旧结构没有该字段。
    """
    data = _load_yaml()
    entry = data.get(project_name, {}).get(file_name, {})
    if isinstance(entry, dict):
        lst = entry.get('by_order')
        if isinstance(lst, list):
            # 归一化字段
            normalized: List[Dict[str, str]] = []
            for item in lst:
                if not isinstance(item, dict):
                    continue
                normalized.append({
                    'address': (item.get('address') or '').strip(),
                    'email': item.get('email', ''),
                    'password': item.get('password', '')
                })
            return normalized
    return []


def read_accounts_slots(project_name: str, file_name: str) -> Dict[str, Dict[str, str]]:
    """读取基于槽位（SCS_1..N）的账号映射。"""
    data = _load_yaml()
    entry = data.get(project_name, {}).get(file_name, {})
    if isinstance(entry, dict):
        slots = entry.get('by_slot')
        if isinstance(slots, dict):
            normalized: Dict[str, Dict[str, str]] = {}
            for k, v in slots.items():
                normalized[str(k)] = {
                    'address': (v or {}).get('address', ''),
                    'email': (v or {}).get('email', ''),
                    'password': (v or {}).get('password', '')
                }
            return normalized
    return {}


def read_product_address_slots(project_name: str, file_name: str) -> Dict[str, str]:
    """读取保存的产品地址槽位映射（SCS_1..N -> 地址）。"""
    data = _load_yaml()
    entry = data.get(project_name, {}).get(file_name, {})
    if isinstance(entry, dict):
        pa = entry.get('product_address_slots')
        if isinstance(pa, dict):
            normalized: Dict[str, str] = {}
            for k, v in pa.items():
                normalized[str(k)] = (v or '').strip()
            return normalized
    return {}


def generate_unique_accounts_for_addresses(addresses: List[str]) -> Dict[str, Dict[str, str]]:
    """为给定地址列表生成唯一的邮箱与密码。
    - 邮箱：使用 Faker.unique.email 保证本次调用内唯一性，必要时退化到 username+随机数 方案
    - 密码：固定 '123456'（与前端兼容）
    返回按地址去重后的映射；重复地址只保留一个账号。
    """
    unique_accounts: Dict[str, Dict[str, str]] = {}
    used_emails = set()

    # 确保每次调用的唯一池被重置
    try:
        faker.unique.clear()
    except Exception:
        pass

    for addr in addresses or []:
        addr_str = (addr or '').strip()
        if not addr_str:
            continue
        if addr_str in unique_accounts:
            continue

        # 生成唯一邮箱
        email_value = ''
        for _ in range(5):
            try:
                candidate = faker.unique.email()
            except Exception:
                candidate = f"{faker.user_name()}.{faker.random_int(min=1000, max=999999)}@{faker.free_email_domain()}"
            if candidate not in used_emails:
                email_value = candidate
                used_emails.add(candidate)
                break
        if not email_value:
            email_value = f"user{faker.random_number(digits=8)}@example.com"

        password_value = '123456'

        unique_accounts[addr_str] = {
            'email': email_value,
            'password': password_value
        }

    return unique_accounts


def generate_unique_accounts_list_for_addresses(addresses: List[str]) -> List[Dict[str, str]]:
    """为地址列表逐项生成账号（保留顺序与重复）。
    返回长度与输入一致的列表，每项包含 {email, password}。
    """
    accounts_list: List[Dict[str, str]] = []

    # 每次调用重置 unique 池，避免邮箱重复
    try:
        faker.unique.clear()
    except Exception:
        pass

    used_emails = set()

    for _ in addresses or []:
        # 生成唯一邮箱
        email_value = ''
        for _try in range(5):
            try:
                candidate = faker.unique.email()
            except Exception:
                candidate = f"{faker.user_name()}.{faker.random_int(min=1000, max=999999)}@{faker.free_email_domain()}"
            if candidate not in used_emails:
                email_value = candidate
                used_emails.add(candidate)
                break
        if not email_value:
            email_value = f"user{faker.random_number(digits=8)}@example.com"

        password_value = '123456'

        accounts_list.append({
            'email': email_value,
            'password': password_value
        })

    return accounts_list


def read_all_accounts_by_address() -> Dict[str, Dict[str, str]]:
    """扫描全局 YAML，聚合所有项目下 by_address 与 by_order 的账号，按地址取第一条非空。"""
    data = _load_yaml()
    result: Dict[str, Dict[str, str]] = {}

    # 先聚合 by_address（优先）
    for project_name, files in (data or {}).items():
        if not isinstance(files, dict):
            continue
        for file_name, node in (files or {}).items():
            if not isinstance(node, dict):
                continue
            by_addr = node.get('by_address')
            if isinstance(by_addr, dict):
                for addr_key, info in by_addr.items():
                    addr = (addr_key or '').strip()
                    if not addr or addr in result:
                        continue
                    email_value = (info or {}).get('email', '')
                    password_value = (info or {}).get('password', '')
                    if (email_value and email_value.strip()) or (password_value and password_value.strip()):
                        result[addr] = {
                            'email': email_value,
                            'password': password_value
                        }

    # 再尝试 by_order 填补缺失地址（仅取第一条出现的地址）
    for project_name, files in (data or {}).items():
        if not isinstance(files, dict):
            continue
        for file_name, node in (files or {}).items():
            if not isinstance(node, dict):
                continue
            by_order = node.get('by_order')
            if isinstance(by_order, list):
                for item in by_order:
                    if not isinstance(item, dict):
                        continue
                    addr = (item.get('address') or '').strip()
                    if not addr or addr in result:
                        continue
                    email_value = item.get('email', '')
                    password_value = item.get('password', '')
                    if (email_value and email_value.strip()) or (password_value and password_value.strip()):
                        result[addr] = {
                            'email': email_value,
                            'password': password_value
                        }
    return result


def read_accounts_by_addresses(addresses: List[str]) -> Dict[str, Dict[str, str]]:
    """根据地址列表返回对应的账号（全局聚合后按地址匹配）。"""
    flattened = read_all_accounts_by_address()
    resolved: Dict[str, Dict[str, str]] = {}
    for addr in addresses or []:
        key = (addr or '').strip()
        if not key:
            continue
        if key in flattened:
            resolved[key] = {
                'email': flattened[key].get('email', ''),
                'password': flattened[key].get('password', '')
            }
    return resolved


def _build_grouped_accounts_by_address_from_all_projects() -> Dict[str, List[Dict[str, str]]]:
    """扫描全局 YAML，按 address 分组聚合所有项目/文件的 by_order 条目，保持原始出现顺序。
    返回：address -> [{email,password}, ...]
    """
    data = _load_yaml()
    grouped: Dict[str, List[Dict[str, str]]] = {}
    for _project, files in (data or {}).items():
        if not isinstance(files, dict):
            continue
        for _file, node in (files or {}).items():
            if not isinstance(node, dict):
                continue
            by_order = node.get('by_order')
            if not isinstance(by_order, list):
                continue
            for item in by_order:
                if not isinstance(item, dict):
                    continue
                addr = (item.get('address') or '').strip()
                if not addr:
                    continue
                email_value = item.get('email', '')
                password_value = item.get('password', '')
                if (email_value and email_value.strip()) or (password_value and password_value.strip()):
                    if addr not in grouped:
                        grouped[addr] = []
                    grouped[addr].append({
                        'email': email_value,
                        'password': password_value
                    })
    return grouped


def lookup_accounts_for_addresses(addresses: List[str]) -> Dict[str, Any]:
    """为地址列表提供两类返回：
    - accounts: 去重后的按地址映射（by_address / by_order 首条）
    - accounts_list: 全局聚合的 by_order 条目扁平化列表（包含 address 字段，用于重复地址顺序分配）
    """
    log_info(f"lookup_accounts_for_addresses called with {len(addresses)} addresses: {addresses}")
    flattened = read_all_accounts_by_address()
    grouped = _build_grouped_accounts_by_address_from_all_projects()
    log_info(f"Flattened keys: {list(flattened.keys())}")
    log_info(f"Grouped keys: {list(grouped.keys())}")
    for key, accounts in grouped.items():
        log_info(f"  {key}: {len(accounts)} accounts")

    # accounts（按地址去重映射）
    accounts: Dict[str, Dict[str, str]] = {}
    for addr in addresses or []:
        key = (addr or '').strip()
        if not key or key in accounts:
            continue
        if key in flattened:
            accounts[key] = {
                'email': flattened[key].get('email', ''),
                'password': flattened[key].get('password', '')
            }

    # accounts_list（按输入地址顺序生成，为重复地址分配不同账号）
    accounts_list: List[Dict[str, str]] = []
    address_counters: Dict[str, int] = {}  # 记录每个地址已使用的账号索引
    
    # 为每个输入地址（包括重复的）生成对应的账号信息
    for addr in addresses or []:
        key = (addr or '').strip()
        if not key:
            # 空地址添加空记录
            accounts_list.append({
                'address': '',
                'email': '',
                'password': ''
            })
            continue
            
        # 获取该地址当前的使用次数
        current_index = address_counters.get(key, 0)
        address_counters[key] = current_index + 1
        log_info(f"Processing address {key}, occurrence #{current_index + 1}")
        
        # 查找该地址的可用账号
        if key in grouped:
            addr_accounts = grouped[key]
            log_info(f"Address {key}: found {len(addr_accounts)} accounts, current_index={current_index}")
            if addr_accounts and current_index < len(addr_accounts):
                # 使用该地址的第current_index个账号
                selected_account = addr_accounts[current_index]
                log_info(f"Using account at index {current_index}: {selected_account}")
                accounts_list.append({
                    'address': key,
                    'email': selected_account.get('email', ''),
                    'password': selected_account.get('password', '')
                })
            elif addr_accounts:
                # 如果超出可用账号数量，循环使用
                selected_account = addr_accounts[current_index % len(addr_accounts)]
                log_info(f"Cycling account at index {current_index % len(addr_accounts)}: {selected_account}")
                accounts_list.append({
                    'address': key,
                    'email': selected_account.get('email', ''),
                    'password': selected_account.get('password', '')
                })
            else:
                # 该地址没有账号，添加空记录
                log_info(f"No accounts found for address {key}")
                accounts_list.append({
                    'address': key,
                    'email': '',
                    'password': ''
                })
        elif key in flattened:
            # 从扁平化数据中获取（单个账号，重复使用）
            accounts_list.append({
                'address': key,
                'email': flattened[key].get('email', ''),
                'password': flattened[key].get('password', '')
            })
        else:
            # 未找到该地址的账号，添加空记录
            accounts_list.append({
                'address': key,
                'email': '',
                'password': ''
            })

    # 不生成新账号：lookup 仅返回已有数据

    log_info(f"Returning {len(accounts)} accounts and {len(accounts_list)} accounts_list items")
    log_info(f"accounts_list: {accounts_list}")
    return {
        'accounts': accounts,
        'accounts_list': accounts_list
    }


# 新增：按步骤追加保存账号结构，避免同项目多次注册覆盖
def write_step_accounts(
    project_name: str,
    file_name: str,
    step_index: int,
    step_name: str,
    operation_event: str,
    accounts: Optional[Dict[str, Dict[str, str]]] = None,
    accounts_list: Optional[List[Dict[str, str]]] = None,
    accounts_slots: Optional[Dict[str, Dict[str, str]]] = None,
    product_address_slots: Optional[Dict[str, str]] = None,
) -> None:
    data = _load_yaml()
    if project_name not in data:
        data[project_name] = {}
    if file_name not in data[project_name]:
        data[project_name][file_name] = {}

    # 确保节点为 dict
    if not isinstance(data[project_name][file_name], dict):
        data[project_name][file_name] = {}

    node = data[project_name][file_name]

    # 初始化 by_step 列表
    if 'by_step' not in node or not isinstance(node['by_step'], list):
        node['by_step'] = []

    # 规整各子结构
    safe_by_address: Dict[str, Dict[str, str]] = {}
    for addr, info in (accounts or {}).items():
        if not addr:
            continue
        safe_by_address[addr] = {
            'email': (info or {}).get('email', ''),
            'password': (info or {}).get('password', '')
        }

    safe_by_order: List[Dict[str, str]] = []
    for item in (accounts_list or []):
        if not isinstance(item, dict):
            continue
        safe_by_order.append({
            'address': (item.get('address') or '').strip(),
            'email': item.get('email', ''),
            'password': item.get('password', '')
        })

    safe_by_slot: Dict[str, Dict[str, str]] = {}
    for slot_key, info in (accounts_slots or {}).items():
        if not slot_key:
            continue
        safe_by_slot[str(slot_key)] = {
            'address': (info or {}).get('address', ''),
            'email': (info or {}).get('email', ''),
            'password': (info or {}).get('password', '')
        }

    safe_pa: Dict[str, str] = {}
    for slot_key, addr in (product_address_slots or {}).items():
        if not slot_key:
            continue
        safe_pa[str(slot_key)] = (addr or '').strip()

    # 追加记录
    node['by_step'].append({
        'step_index': int(step_index),
        'step_name': step_name or f'step_{int(step_index)}',
        'operation_event': operation_event or '',
        'by_address': safe_by_address,
        'by_order': safe_by_order,
        'by_slot': safe_by_slot,
        'product_address_slots': safe_pa
    })

    data[project_name][file_name] = node
    _save_yaml(data)