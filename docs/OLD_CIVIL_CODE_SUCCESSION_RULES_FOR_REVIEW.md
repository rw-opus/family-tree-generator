# Old Civil Code Succession Rules - Review Draft

## Purpose and scope

This is a proposed calculation specification extracted from the supplied scanned
Civil Code. It covers the former provisions on:

- the disposable portion and legitim (sections 614-653); and
- intestate succession (sections 788-830).

It is intended for deaths before 1 March 2005. It is a review draft for the
calculator, not a legal opinion.

The supplied scan is a consolidated text containing amendments made at
different dates. It does not by itself prove that every displayed rule applied
unchanged to every death before 1 March 2005. The calculator must follow the
legislation in force on the date of death and therefore requires the relevant
statutory commencement and repeal dates.

## Verified legislative history: Act XXI of 1993

The official text of the
[Civil Code (Amendment) (No. 2) Act, 1993 (Act XXI of 1993)](https://legislation.mt/eli/act/1993/21/eng)
and
[Legal Notice 127 of 1993](https://legislation.mt/eli/ln/1993/127/eng)
establish the following date band:

- Act XXI of 1993 was enacted on 20 August 1993.
- Section 1(2) allowed the Minister for Justice to appoint commencement dates
  by Gazette order, including different dates for different provisions.
- Legal Notice 127 of 1993 appointed **1 December 1993** as the date on which
  **all provisions of the Act** came into force. The notice did not phase the
  relevant provisions.

Accordingly, the amendments below apply to deaths on or after 1 December 1993.
They cannot be applied retrospectively to a death before that date merely
because the succession is entered into the calculator later.

### Verified effect of sections 66-75

| Act section | Civil Code provision | Verified change from 1 December 1993                                                                                                                                                                 | Ownership-calculator consequence                                                                                                                                                                                              |
| ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 66          | 623(f)               | Replaced one statutory ground of disherison concerning public prostitution by a son, daughter or other descendant.                                                                                   | No automatic fraction changes. Any relied-on disherison still requires an express will ground and legal review.                                                                                                               |
| 67          | 631(1)               | Made the surviving spouse's section 631 rights subject to new section 633A.                                                                                                                          | Consequential to the new habitation right; it does not itself create a full-ownership fraction.                                                                                                                               |
| 68          | New 633A             | Added a surviving spouse's right of habitation over the principal residence, together with detailed scope, priority, creditor, agreement and remarriage rules.                                       | Do not convert this personal right into ownership. Under the current product instruction, omit it from the fraction calculation.                                                                                              |
| 69          | 634(1)               | Deleted the words referring to the surviving wife's dower.                                                                                                                                           | No new automatic ownership fraction.                                                                                                                                                                                          |
| 70          | 636                  | Added references to section 633A and removed obsolete cross-references to sections 49 and 50.                                                                                                        | Consequential only for the present ownership calculation.                                                                                                                                                                     |
| 71          | 638 and 639          | Repealed both sections.                                                                                                                                                                              | They do not apply to deaths on or after 1 December 1993. Their former text is still needed before automating deaths before that date.                                                                                         |
| 72          | 646                  | Made the spouse's portion expressly without prejudice to section 633A.                                                                                                                               | The new habitation right remains separate from ownership fractions.                                                                                                                                                           |
| 73          | 825                  | Substituted section 825: where the deceased leaves the children or descendants referred to in section 631, the surviving spouse has only the rights under sections 631, 632, 633A, 634, 635 and 637. | Confirms that, for this date band, the surviving spouse receives no intestate full-ownership fraction alongside those descendants. The descendants take the ownership estate, subject to ignored non-ownership spouse rights. |
| 74          | 826(1)               | Added the surviving spouse's section 633A habitation right and made the section 826 distribution operate on property not subject to that right.                                                      | The spouse's habitation right may burden the residence but is not deducted as an ownership fraction. The section 826 ownership proportions remain as stated below.                                                            |
| 75          | 829                  | Removed cross-references to repealed sections 49 and 50 from the separation-related disqualification rule.                                                                                           | No standalone arithmetic change; the section 829 disqualification must still be checked.                                                                                                                                      |

### What Act XXI of 1993 does not yet resolve

The Act shows exactly what changed on 1 December 1993, but it does not reproduce
all of the immediately preceding law. For deaths before 1 December 1993, the
calculator still needs an authoritative pre-amendment text of sections 623,
631, 634, 636, 638, 639, 646, 825, 826 and 829. Section 825 is particularly
important because Act XXI of 1993 replaced it in full; the prior wording cannot
be reconstructed safely from the amending Act alone.

Per the current product instruction, habitation and usufruct rights are
identified below but must not be converted into property ownership fractions.

## A. Intestate succession

### A1. When intestacy applies - sections 788-800

Intestacy operates wholly or partly when:

- there is no valid will;
- the will does not dispose of the whole estate;
- the instituted heirs cannot or will not accept; or
- an undisposed share does not pass by accretion.

The former section 789 identifies the relevant classes as descendants,
ascendants, collateral relatives, children described by the former Code as
illegitimate children, the surviving spouse, and ultimately the Government of
Malta. The detailed provisions below determine their priority.

Relationship is measured by generations. The direct line connects ancestors
and descendants. The collateral line connects persons through a common
ancestor. In the collateral line, degrees are counted up to the common ancestor
and then down to the other relative.

Persons incapable or unworthy of taking under a will are generally incapable
or unworthy of taking on intestacy. Their descendants are not automatically
excluded and may take in their own right or by representation.

### A2. Representation - sections 801-807

1. The representative takes the place, degree and rights of the represented
   person.
2. In the descending direct line, representation continues without a fixed
   generational limit.
3. It applies where a child predeceases the deceased and that child's
   descendants take the child's branch.
4. It also applies where all children predeceased and the living descendants
   are in equal or unequal degrees.
5. Representation does not operate upwards between ascendants. The nearest
   eligible ascendant excludes the more remote ascendant, subject to the
   paternal/maternal line rule below.
6. In the collateral line, representation is allowed for children and further
   descendants of the deceased's brothers or sisters.
7. If descendants of brothers or sisters are all in the same degree, they take
   per capita rather than by representation.
8. Where representation applies, division is per stirpes. Further branches
   within the same stock are again divided per stirpes; persons in the same
   branch and degree divide per capita.
9. A living person is not represented. Representation may apply to a person
   who is dead, incapable, presumed dead after long absence, or who renounced
   the inheritance.
10. A predeceased descendant's will does not control the ancestor's later
    estate. The descendant's branch takes by statutory representation.

### A3. Legitimate, legitimated and adopted descendants - sections 808-809

Children and their descendants inherit from their father, mother and other
ascendants without distinction of sex or of whether they derive from the same
or different marriages.

- Children all in the first degree divide equally per capita.
- A branch represented by descendants takes per stirpes.
- The former definition of legitimate children includes children legitimated
  by subsequent marriage, adopted children, and the other categories stated in
  section 809.

#### Calculator rule

If at least one qualifying descendant branch exists, allocate 100% of the
ownership estate among the qualifying child branches. Divide a predeceased
child's branch recursively by representation.

If a surviving spouse also exists, former section 825 gives that spouse only
the usufruct, habitation and related rights referred to in sections 631, 632,
633A, 634, 635 and 637. Under the current product instruction to ignore those
rights, the spouse receives no ownership fraction in this scenario.

### A4. Parents, other ascendants, siblings and sibling branches - sections

810-814

#### Parents without descendants or sibling branches - section 810

If there are no qualifying descendants, siblings, or descendants of siblings:

- both parents alive: one-half each;
- one parent alive: that parent takes 100%.

This rule is subject to any surviving-spouse share under sections 826-827.

#### Remoter ascendants without descendants, parents or sibling branches -

section 811

- Paternal and maternal ascendants in the same degree: one-half to the paternal
  line and one-half to the maternal line, divided within each line among the
  qualifying ascendants.
- Ascendants in different degrees: the nearest ascendant takes, regardless of
  paternal or maternal line.

This rule is subject to any surviving-spouse share under sections 826-827.

#### Ascendants competing with siblings or sibling branches - section 813

Where one or more parents or other eligible ascendants compete with brothers,
sisters or represented sibling branches:

- every surviving eligible parent or ascendant and every surviving brother or
  sister is an equal per-capita head; and
- each represented branch of a predeceased brother or sister takes one equal
  head per stirpes.

If a surviving spouse exists, apply this rule only to the half remaining after
the spouse's section 826 share.

Example: one surviving parent, two surviving siblings and one represented
sibling branch produce four heads. Each head receives one-quarter of the amount
being distributed. The represented branch then subdivides its quarter.

#### Siblings and sibling branches without descendants or ascendants - section

814

- Surviving brothers and sisters take equal shares per capita.
- A predeceased brother's or sister's descendants take that sibling's branch
  per stirpes.

If a surviving spouse exists, apply this rule only to the half remaining after
the spouse's section 826 share.

### A5. Uncles, aunts and remoter collateral relatives - sections 815-816

Only after failure of descendants, ascendants, siblings and represented sibling
branches does the estate pass:

1. to uncles and aunts; then
2. to the nearest collateral relative in any line.

Collateral succession does not extend beyond the twelfth degree.

A surviving spouse excludes these remoter collaterals because section 827 gives
the spouse the whole estate when the persons listed in section 826 do not
exist, subject to the former section 818.

### A6. Former separate rules for children born outside marriage - sections

817-824

The source uses historical terminology that should not be displayed as modern
product language. The data model nevertheless needs to preserve the legal
status distinctions required by the old provisions.

#### Qualification - sections 817-818

- A child qualified under the old rules if legitimised by court decree,
  acknowledged in one of the statutory modes, or declared to be the child of
  the deceased by a competent court.
- A child who did not satisfy those recognition modes could still have the
  limited entitlement fixed under sections 640-642.
- If nobody other than the Government was called, former section 818 gave that
  child the whole estate in preference to the Government.

#### Recognised or legitimised child with legitimate descendants - sections

819(a) and 640(a)

For calculation purposes:

1. Count the legitimate child branches and the qualifying recognised children
   as required by section 640(2).
2. Compute the hypothetical old-law child legitim:
   - one to four counted branches: collective legitim = 1/3;
   - five or more counted branches: collective legitim = 1/2.
3. Divide that collective legitim by the counted branches.
4. Each qualifying recognised child receives one-third of the hypothetical
   individual legitim share that child would have received if legitimate.
5. The balance passes to the legitimate-descendant class under section 808.

This formula should be confirmed before automatic implementation because it is
status-sensitive and uses cross-references between the intestacy and legitim
provisions.

#### No legitimate descendants - section 819(b)-(c)

- Qualifying recognised children plus parents or other ascendants, but no
  spouse: recognised children collectively take 2/3; the ascendant class takes
  1/3.
- Qualifying recognised children plus a spouse: recognised children
  collectively take 2/3 and the spouse takes 1/3. If ascendants also survive,
  the spouse takes that 1/3 to the exclusion of the ascendants.
- No legitimate descendants, ascendants or spouse: recognised children take
  100%, excluding collateral relatives.

Section 821 allows the descendants of a predeceased qualifying child to claim
that child's rights.

#### Succession to such a child's estate - sections 823-824

Where that child dies without issue:

- no surviving spouse: the legally established parent takes 100%, or both
  established parents take one-half each;
- surviving spouse: spouse takes 2/3 and the legally established parent or
  parents share the remaining 1/3.

For the calculator, former section 822 is to be treated as operative until the
date on which the legislation itself amended or repealed it. The 1997 judgment
does not create a calculator date boundary and is not required as a source. The
statutory change and its commencement date must instead be identified.

### A7. Surviving spouse - sections 825-829

#### With legitimate descendants - section 825

The spouse receives the former usufruct, habitation and related protections,
but no ownership fraction under section 825. The product is currently to ignore
those non-ownership rights.

#### Without legitimate descendants - section 826

- With qualifying recognised children: spouse takes 1/3 in full ownership;
  those children collectively take 2/3.
- With ascendants, siblings or represented sibling branches, but no qualifying
  recognised children: spouse takes 1/2 in full ownership.
- The remaining 1/2 is distributed under sections 810, 811, 813 or 814,
  according to which relatives survive.

#### Spouse otherwise alone - section 827

If none of the persons identified in section 826 exists, the spouse takes 100%,
subject to any former section 818 entitlement. Uncles, aunts and remoter
collaterals do not share with the spouse.

#### Disqualification - section 829

The spouse does not receive the section 825-827 rights where, at the death, the
spouses were separated from bed and board by a competent-court judgment and the
surviving spouse had forfeited the referenced rights.

### A8. Government - section 830

If no person qualifies under the preceding rules, the estate passes to the
Government of Malta.

### A9. Special property-return rule - section 812

Section 812 gives an ascendant a special right to take back in kind certain
property previously given by that ascendant as dowry or otherwise, where the
recipient descendant dies without issue and without disposing of it. If the
property was alienated, the ascendant may take the outstanding price or related
action.

This is property-specific and cannot safely be inferred from the family tree.
The calculator should flag it for manual review rather than apply it
automatically.

## B. Testate succession and old-law legitim

### B1. Disposable portion - sections 614-615

- If there are no protected descendants, ascendants, spouse or qualifying
  children under the former separate rules, the testator may dispose of the
  whole estate.
- Otherwise, the disposable portion is the balance after deducting the rights
  protected by sections 615-653.
- The primary legitim belongs to descendants and, failing the classes specified
  by section 619, to ascendants.

### B2. Child legitim - sections 616-618

Let `N` be the number of counted legitimate child branches:

| Counted branches | Collective child legitim | Normal share per branch |
| ---------------- | -----------------------: | ----------------------: |
| 1-4              |                      1/3 |           `1 / (3 x N)` |
| 5 or more        |                      1/2 |           `1 / (2 x N)` |

Rules:

1. The fraction is the collective legitim, not the fraction of each child.
2. Descendants of one child count as one child branch.
3. Branch descendants divide that branch by representation.
4. An incapable, disinherited or renouncing child remains counted when choosing
   between the one-third and one-half collective legitim.
5. Subject to sections 608 and 626, that person's legitim share devolves on the
   other children or descendants taking the legitim.
6. A child instituted as heir still participates in the legitim.
7. Where the will already gives a child an intestate or larger share, the
   legitim is absorbed in that larger share and is not added again.

### B3. Ascendant legitim - sections 619-620

Ascendant legitim applies only where the testator leaves:

- no legitimate children or descendants under sections 616-617;
- no qualifying recognised or legitimised children under section 819; and
- no surviving spouse.

The collective ascendant legitim is 1/3:

- both parents: one-sixth each;
- one parent: that parent takes the whole one-third;
- no parents, but paternal and maternal ascendants in the same degree: one-half
  of the legitim to each line;
- ascendants in different degrees: the nearest ascendant takes the whole
  legitim.

The legitim is in full ownership and cannot be burdened or made conditional. It
is computed on the net estate after estate debts and funeral expenses, with the
gratuitous dispositions required by section 620 notionally added. Property
already received and subject to collation is imputed to the claimant's legitim.

### B4. Surviving spouse under a will - sections 631-637

- With legitimate descendants, section 631 gives the spouse usufruct of
  one-half of the estate, not a full-ownership share. This is excluded from the
  ownership calculator under the present instruction.
- Without legitimate descendants, section 633 gives the spouse one-quarter of
  the estate in full ownership.
- Section 633A adds habitation rights, which the product is to ignore.
- Sections 632 and 634-637 regulate maintenance, offsets, loss and conversion of
  those spouse rights. They do not create an additional automatic ownership
  fraction for the present calculator beyond section 633.

### B5. Former protected portions for children born outside marriage - sections

640-646

For a child acknowledged or legitimised in the manner required by section 640:

- with legitimate descendants: each such child's protected portion is
  one-third of the hypothetical individual legitim the child would receive if
  legitimate;
- without legitimate descendants: each such child's protected portion is
  one-half of that hypothetical individual legitim;
- section 640(2) requires those children to be counted when calculating the
  underlying hypothetical child legitim;
- the heirs may satisfy the portion in cash or estate property on a valuation;
- judicially established maternity or paternity is subject to the distinctions
  in sections 641-642;
- the portion is subject to collation and the former forfeiture/disherison
  provisions;
- descendants of a predeceased qualifying child may claim that child's rights;
- under section 646, spouse and such-child portions are charged against the
  disposable portion and do not diminish the legitim of legitimate descendants
  or ascendants.

These rules require explicit legal-status data and should not be inferred from
sex, surname, partnership or parent links.

### B6. Disherison - sections 622-630

For the calculator's default path, assume children and descendants are capable
and entitled. Manual departure should require an express user choice.

The source nevertheless provides that:

- disherison must be expressly declared in the will on a statutory ground;
- the party relying on it must prove the ground;
- where the disinherited person has descendants, section 626 directs the
  deprived legitim to those descendants;
- if the disinherited person predeceases the testator, the disherison does not
  prejudice the descendants;
- if the ground is absent or unproved, the person remains entitled to the
  legitim.

### B7. Abatement - sections 647-653

If testamentary dispositions exceed the disposable portion:

1. Form the estate bulk from property existing at death after debts.
2. Notionally add the donations required by section 648.
3. Compute the protected portions and resulting disposable portion.
4. If donations equal or exceed the disposable portion, testamentary
   dispositions are ineffective to the necessary extent.
5. Otherwise abate excessive testamentary dispositions proportionately,
   subject to a valid preference expressed by the testator.
6. A separable excess may be removed in kind; otherwise the beneficiary may pay
   the required amount in cash as provided by section 653.

## C. Proposed automatic decision order

For a death before 1 March 2005:

1. Determine whether the estate is intestate, testate, or partly intestate.
2. Build descendant branches recursively and apply representation before
   looking at the will of any predeceased descendant.
3. Identify whether the old legal-status distinctions in sections 817-824 or
   640-646 are relevant. Do not infer them.
4. For intestacy, apply the following ownership priority:
   - legitimate-descendant class;
   - qualifying recognised-child rules;
   - spouse together with ascendants or sibling branches;
   - ascendants and sibling branches;
   - spouse alone;
   - uncles and aunts;
   - nearest collateral up to the twelfth degree;
   - Government.
5. Ignore habitation and usufruct when producing ownership fractions, while
   optionally displaying a legal-information warning that such rights may
   exist.
6. For a will, allocate the testamentary dispositions, then enforce any
   applicable old-law full-ownership legitim and abatement rules.
7. Require all calculated ownership fractions to total 100%, allowing the user
   to override the proposed fractions with a recorded explanation.

## D. Points requiring confirmation before full automation

1. The calculator must use 1 December 1993 as a legislative boundary. The
   post-1 December 1993 rules are verified above; the immediately preceding
   text still has to be sourced before deaths before that date can be fully
   automated.
2. The statutory instrument that amended or repealed former section 822, and
   its commencement date, still have to be identified. The 1997 judgment is not
   used as the calculator boundary.
3. Whether cases involving the former sections 817-824 and 640-646 should be
   automated or always sent to manual legal review.
4. Whether the section 812 return of property to an ascendant should be shown as
   a warning only.
5. Whether the system should display informational warnings for ignored
   habitation or usufruct rights without including them in ownership.
6. Whether the historical legal-status terminology should be hidden entirely
   from the user interface and replaced by neutral structured questions.
