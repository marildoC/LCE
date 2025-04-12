
CREATE TABLE employees(
    emp_id INTEGER PRIMARY KEY,
    name TEXT,
    position TEXT,
    salary REAL
);
INSERT INTO employees(name, position, salary) VALUES
('Alice', 'Sales Rep', 45000),
('Bob', 'HR Manager', 60000),
('Charlie', 'IT Support', 50000),
('Diana', 'Marketing Lead', 65000),
('Edward', 'Sales Rep', 43000),
('Fiona', 'Developer', 70000),
('George', 'Developer', 72000),
('Helen', 'Designer', 58000),
('Ian', 'Accountant', 55000),
('Jane', 'CTO', 90000);

CREATE TABLE orders(
    order_id INTEGER PRIMARY KEY,
    emp_id INTEGER,
    product TEXT,
    quantity INTEGER,
    price REAL
);
INSERT INTO orders(emp_id, product, quantity, price) VALUES
(1, 'Laptop', 2, 999.99),
(3, 'Monitor', 1, 149.99),
(1, 'Desk', 5, 89.99),
(5, 'Keyboard', 10, 29.99),
(2, 'Office Chair', 2, 129.99),
(7, 'Server Rack', 1, 799.99),
(6, 'Mouse', 20, 14.99),
(4, 'Headset', 3, 39.99),
(8, 'Pen Pack', 50, 5.99),
(9, 'Paper Reams', 10, 12.99);

CREATE TABLE shipping(
    ship_id INTEGER PRIMARY KEY,
    order_id INTEGER,
    ship_date TEXT,
    status TEXT
);
INSERT INTO shipping(order_id, ship_date, status) VALUES
(1, '2023-07-01', 'Shipped'),
(2, '2023-07-02', 'Shipped'),
(3, '2023-07-03', 'In Process'),
(4, '2023-07-04', 'In Process'),
(5, '2023-07-05', 'Pending'),
(6, '2023-07-06', 'Shipped'),
(7, '2023-07-07', 'Pending'),
(8, '2023-07-08', 'Shipped'),
(9, '2023-07-09', 'In Process'),
(10, '2023-07-10', 'Pending');

CREATE TABLE customers(
    cust_id INTEGER PRIMARY KEY,
    name TEXT,
    region TEXT
);
INSERT INTO customers(name, region) VALUES
('Acme Corp', 'North'),
('Beta LLC', 'South'),
('Gamma Inc', 'East'),
('Delta Partners', 'West'),
('Epsilon Co', 'North'),
('Foxtrot Group', 'East'),
('Helix Solutions', 'South'),
('Ion Tech', 'North'),
('Jupiter Traders', 'West'),
('Kappa Industries', 'Eastt');
