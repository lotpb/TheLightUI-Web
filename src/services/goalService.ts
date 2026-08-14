import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { type GoalDoc, type GoalValues, emptyGoalValues } from '../models/goal'

const COLLECTION = 'Goals'

function valuesFromDoc(d: Record<string, unknown>, key: string): GoalValues {
  const v = d[key]
  if (typeof v !== 'object' || v === null) return emptyGoalValues()
  const obj = v as Record<string, unknown>
  return {
    revenue:   typeof obj['revenue']   === 'number' ? obj['revenue']   : 0,
    leads:     typeof obj['leads']     === 'number' ? obj['leads']     : 0,
    customers: typeof obj['customers'] === 'number' ? obj['customers'] : 0,
  }
}

function tsToDate(ts: unknown): Date {
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return new Date()
}

export async function getGoals(): Promise<GoalDoc | null> {
  const companyId = getCompanyId()
  if (!companyId) return null

  const ref  = doc(db, COLLECTION, companyId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null

  const d = snap.data() as Record<string, unknown>
  return {
    companyId,
    month:   valuesFromDoc(d, 'month'),
    quarter: valuesFromDoc(d, 'quarter'),
    year:    valuesFromDoc(d, 'year'),
    updatedAt: tsToDate(d['updatedAt']),
  }
}

export async function saveGoals(
  goals: Pick<GoalDoc, 'month' | 'quarter' | 'year'>
): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const ref = doc(db, COLLECTION, companyId)
  await setDoc(ref, {
    companyId,
    month:   goals.month,
    quarter: goals.quarter,
    year:    goals.year,
    updatedAt: Timestamp.now(),
  })
}
