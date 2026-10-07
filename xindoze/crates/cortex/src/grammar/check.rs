//! Test-only GBNF recognizer: parses the grammars we generate and checks
//! whether a string is in the language, so tests exercise real acceptance
//! instead of comparing grammar text.

use std::collections::{BTreeSet, HashMap};

#[derive(Debug)]
enum Expr {
    Alt(Vec<Expr>),
    Seq(Vec<Expr>),
    Lit(Vec<char>),
    Class {
        negated: bool,
        ranges: Vec<(char, char)>,
    },
    Ref(String),
    Repeat(Box<Expr>, usize, Option<usize>),
}

pub struct Grammar {
    rules: HashMap<String, Expr>,
}

impl Grammar {
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut rules = HashMap::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let (name, body) = line
                .split_once(" ::= ")
                .ok_or(format!("bad rule: {line}"))?;
            let mut p = Parser {
                s: body.chars().collect(),
                i: 0,
            };
            let expr = p.alt()?;
            if p.i != p.s.len() {
                return Err(format!("trailing input in rule {name} at {}", p.i));
            }
            if rules.insert(name.to_string(), expr).is_some() {
                return Err(format!("rule {name} defined twice"));
            }
        }
        let g = Self { rules };
        for e in g.rules.values() {
            g.check_refs(e)?;
        }
        g.rules.get("root").ok_or("no root rule")?;
        Ok(g)
    }

    fn check_refs(&self, e: &Expr) -> Result<(), String> {
        match e {
            Expr::Alt(v) | Expr::Seq(v) => v.iter().try_for_each(|x| self.check_refs(x)),
            Expr::Repeat(x, ..) => self.check_refs(x),
            Expr::Ref(n) if !self.rules.contains_key(n) => Err(format!("undefined rule {n}")),
            _ => Ok(()),
        }
    }

    /// Whether the whole of `input` matches `root`.
    pub fn accepts(&self, input: &str) -> bool {
        let chars: Vec<char> = input.chars().collect();
        let mut memo = HashMap::new();
        self.ends(&Expr::Ref("root".into()), &chars, 0, &mut memo)
            .contains(&chars.len())
    }

    /// Every position where a match of `e` starting at `pos` can end.
    fn ends(
        &self,
        e: &Expr,
        input: &[char],
        pos: usize,
        memo: &mut HashMap<(String, usize), BTreeSet<usize>>,
    ) -> BTreeSet<usize> {
        match e {
            Expr::Lit(lit) => {
                if input[pos..].starts_with(lit) {
                    BTreeSet::from([pos + lit.len()])
                } else {
                    BTreeSet::new()
                }
            }
            Expr::Class { negated, ranges } => match input.get(pos) {
                Some(c) if ranges.iter().any(|(a, b)| (a..=b).contains(&c)) != *negated => {
                    BTreeSet::from([pos + 1])
                }
                _ => BTreeSet::new(),
            },
            Expr::Ref(name) => {
                let key = (name.clone(), pos);
                if let Some(hit) = memo.get(&key) {
                    return hit.clone();
                }
                let out = self.ends(&self.rules[name], input, pos, memo);
                memo.insert(key, out.clone());
                out
            }
            Expr::Alt(alts) => alts
                .iter()
                .flat_map(|a| self.ends(a, input, pos, memo))
                .collect(),
            Expr::Seq(items) => {
                let mut at = BTreeSet::from([pos]);
                for item in items {
                    at = at
                        .into_iter()
                        .flat_map(|p| self.ends(item, input, p, memo))
                        .collect();
                }
                at
            }
            Expr::Repeat(x, min, max) => {
                let mut out = BTreeSet::new();
                if *min == 0 {
                    out.insert(pos);
                }
                let mut at = BTreeSet::from([pos]);
                let limit = max.unwrap_or(input.len() + 1);
                for n in 1..=limit {
                    at = at
                        .into_iter()
                        .flat_map(|p| self.ends(x, input, p, memo))
                        .collect();
                    if at.is_empty() {
                        break;
                    }
                    if n >= *min {
                        out.extend(at.iter().copied());
                    }
                }
                out
            }
        }
    }
}

struct Parser {
    s: Vec<char>,
    i: usize,
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.s.get(self.i).copied()
    }

    fn skip_ws(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.i += 1;
        }
    }

    fn next(&mut self) -> Result<char, String> {
        let c = self.peek().ok_or("unexpected end")?;
        self.i += 1;
        Ok(c)
    }

    fn alt(&mut self) -> Result<Expr, String> {
        let mut alts = vec![self.seq()?];
        while self.peek() == Some('|') {
            self.i += 1;
            alts.push(self.seq()?);
        }
        Ok(if alts.len() == 1 {
            alts.remove(0)
        } else {
            Expr::Alt(alts)
        })
    }

    fn seq(&mut self) -> Result<Expr, String> {
        let mut items = vec![];
        loop {
            self.skip_ws();
            let item = match self.peek() {
                None | Some('|') | Some(')') => break,
                Some('"') => {
                    self.i += 1;
                    let mut lit = vec![];
                    loop {
                        match self.next()? {
                            '"' => break,
                            '\\' => lit.push(self.escape()?),
                            c => lit.push(c),
                        }
                    }
                    Expr::Lit(lit)
                }
                Some('[') => {
                    self.i += 1;
                    let negated = self.peek() == Some('^');
                    if negated {
                        self.i += 1;
                    }
                    let mut ranges = vec![];
                    while self.peek() != Some(']') {
                        let a = self.class_char()?;
                        let b = if self.peek() == Some('-') && self.s.get(self.i + 1) != Some(&']')
                        {
                            self.i += 1;
                            self.class_char()?
                        } else {
                            a
                        };
                        ranges.push((a, b));
                    }
                    self.i += 1;
                    Expr::Class { negated, ranges }
                }
                Some('(') => {
                    self.i += 1;
                    let inner = self.alt()?;
                    self.skip_ws();
                    if self.next()? != ')' {
                        return Err("expected )".into());
                    }
                    inner
                }
                Some(c) if c.is_ascii_alphanumeric() || c == '-' => {
                    let start = self.i;
                    while self
                        .peek()
                        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '-')
                    {
                        self.i += 1;
                    }
                    Expr::Ref(self.s[start..self.i].iter().collect())
                }
                Some(c) => return Err(format!("unexpected {c:?} at {}", self.i)),
            };
            items.push(self.postfix(item)?);
        }
        Ok(if items.len() == 1 {
            items.remove(0)
        } else {
            Expr::Seq(items)
        })
    }

    fn postfix(&mut self, item: Expr) -> Result<Expr, String> {
        let rep = |e, min, max| Expr::Repeat(Box::new(e), min, max);
        Ok(match self.peek() {
            Some('*') => {
                self.i += 1;
                rep(item, 0, None)
            }
            Some('+') => {
                self.i += 1;
                rep(item, 1, None)
            }
            Some('?') => {
                self.i += 1;
                rep(item, 0, Some(1))
            }
            Some('{') => {
                self.i += 1;
                let start = self.i;
                while self.peek() != Some('}') {
                    self.next()?;
                }
                let spec: String = self.s[start..self.i].iter().collect();
                self.i += 1;
                let num = |t: &str| t.trim().parse::<usize>().map_err(|e| e.to_string());
                match spec.split_once(',') {
                    None => {
                        let n = num(&spec)?;
                        rep(item, n, Some(n))
                    }
                    Some((a, b)) if b.trim().is_empty() => rep(item, num(a)?, None),
                    Some((a, b)) => rep(item, num(a)?, Some(num(b)?)),
                }
            }
            _ => item,
        })
    }

    fn class_char(&mut self) -> Result<char, String> {
        match self.next()? {
            '\\' => self.escape(),
            c => Ok(c),
        }
    }

    fn escape(&mut self) -> Result<char, String> {
        let hex = |p: &mut Self, n: usize| -> Result<char, String> {
            let digits: String = (0..n).map(|_| p.next()).collect::<Result<_, _>>()?;
            let v = u32::from_str_radix(&digits, 16).map_err(|e| e.to_string())?;
            char::from_u32(v).ok_or_else(|| "bad escape".to_string())
        };
        Ok(match self.next()? {
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            'x' => hex(self, 2)?,
            'u' => hex(self, 4)?,
            c => c,
        })
    }
}
